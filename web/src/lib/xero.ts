import 'server-only'
import { desc, eq } from 'drizzle-orm'
import { withServiceRole, xeroConnections } from '@/db'

export const XERO_TOKEN_URL = 'https://identity.xero.com/connect/token'
export const XERO_API_BASE = 'https://api.xero.com/api.xro/2.0'

/**
 * Resolve the redirect URI Xero must POST back to.
 *
 * **Cutover note (M-Pre task #13 exit criterion):** the path changed from
 * `/functions/v1/xero-callback` (old Supabase Edge Function path) to
 * `/api/xero/callback`. The new value must be registered in the Xero app's
 * "Redirect URIs" list before this handler is exercised in production.
 */
export function xeroCallbackUrl(): string {
  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://listd.co.uk'
  return `${origin}/api/xero/callback`
}

export type XeroAccess = {
  accessToken: string
  tenantId: string
}

/**
 * Look up the user's Xero connection, refresh the access token if it's within
 * 60s of expiry, persist the new tokens, and return a valid access token +
 * tenantId.
 *
 * Uses `withServiceRole` because the Xero connection row is keyed on the
 * userId (which we already verified at the route handler boundary), not the
 * caller's session — and we need to write back the refreshed tokens.
 */
export async function getValidXeroAccess(userId: string): Promise<XeroAccess> {
  const clientId = process.env.XERO_CLIENT_ID
  const clientSecret = process.env.XERO_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    throw new Error('Xero credentials not configured on server')
  }

  const connection = await withServiceRole(async (tx) => {
    const [row] = await tx
      .select()
      .from(xeroConnections)
      .where(eq(xeroConnections.userId, userId))
      .orderBy(desc(xeroConnections.connectedAt))
      .limit(1)
    return row
  })

  if (!connection) {
    throw new Error(
      'No Xero connection found. Please connect your Xero account first.'
    )
  }

  // Token still valid (60s safety margin)?
  const expiresAtMs = new Date(connection.tokenExpiresAt).getTime()
  if (Date.now() < expiresAtMs - 60_000) {
    return {
      accessToken: connection.accessToken,
      tenantId: connection.tenantId,
    }
  }

  // Refresh.
  const refreshResponse = await fetch(XERO_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: connection.refreshToken,
    }),
  })

  if (!refreshResponse.ok) {
    const errText = await refreshResponse.text()
    console.error('[xero] token refresh failed:', errText)
    throw new Error(
      'Failed to refresh Xero token. Please reconnect your Xero account.'
    )
  }

  const tokens = (await refreshResponse.json()) as {
    access_token: string
    refresh_token: string
    expires_in: number
  }
  const newExpiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString()

  await withServiceRole(async (tx) =>
    tx
      .update(xeroConnections)
      .set({
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        tokenExpiresAt: newExpiresAt,
      })
      .where(eq(xeroConnections.id, connection.id))
  )

  return {
    accessToken: tokens.access_token,
    tenantId: connection.tenantId,
  }
}

/** Common headers for Xero API JSON calls. */
export function xeroHeaders(access: XeroAccess) {
  return {
    Authorization: `Bearer ${access.accessToken}`,
    'xero-tenant-id': access.tenantId,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
}

/**
 * Result of `fetchXeroWithRetry` — discriminated union so the caller can
 * pattern-match without re-parsing the response.
 */
export type FetchXeroResult<T> =
  | { ok: true; status: number; data: T; idempotent?: boolean }
  | {
      ok: false
      status: number
      error: unknown
      attempts: number
      retryable: boolean
    }

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504])
const NETWORK_RETRY_DELAY_MS = 500
const DEFAULT_MAX_ATTEMPTS = 3

/**
 * Wrap a Xero API call with retry + idempotency for M2 #2.
 *
 * Behaviour:
 *   - **Idempotency.** Pass a stable `idempotencyKey` (e.g. job UUID + `:invoice`)
 *     and the function adds `Idempotency-Key: <key>`. Xero returns the original
 *     response on retries with the same key, so a network blip mid-create does
 *     not produce duplicate invoices.
 *   - **Retry.** Network errors and HTTP 429 / 5xx retry up to `maxAttempts`
 *     (default 3) with exponential backoff (500ms × 2^attempt). 429 responses
 *     respect the `Retry-After` header (in seconds) when present.
 *   - **Non-retryable.** 4xx (other than 429) returns the response as
 *     `{ ok: false, retryable: false, ... }` immediately so the caller can
 *     surface validation errors back to the user without burning attempts.
 */
export async function fetchXeroWithRetry<T = unknown>(
  url: string,
  init: RequestInit,
  access: XeroAccess,
  options: {
    idempotencyKey?: string
    maxAttempts?: number
  } = {}
): Promise<FetchXeroResult<T>> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
  const headers = new Headers(init.headers ?? xeroHeaders(access))
  if (options.idempotencyKey) {
    headers.set('Idempotency-Key', options.idempotencyKey)
  }

  let lastError: unknown = null
  let lastStatus = 0

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(url, { ...init, headers })
      lastStatus = res.status

      if (res.ok) {
        const data = (await res.json()) as T
        return { ok: true, status: res.status, data }
      }

      // Read body once so error messages have context.
      const errorBody = await readBody(res)
      lastError = errorBody

      const retryable = RETRYABLE_STATUSES.has(res.status)
      if (!retryable || attempt === maxAttempts) {
        return {
          ok: false,
          status: res.status,
          error: errorBody,
          attempts: attempt,
          retryable,
        }
      }

      const retryAfter =
        res.status === 429
          ? Number.parseInt(res.headers.get('retry-after') ?? '', 10)
          : NaN
      const delayMs = Number.isFinite(retryAfter)
        ? retryAfter * 1000
        : NETWORK_RETRY_DELAY_MS * 2 ** (attempt - 1)
      await sleep(delayMs)
    } catch (networkErr) {
      lastError = networkErr
      lastStatus = 0
      if (attempt === maxAttempts) {
        return {
          ok: false,
          status: 0,
          error: networkErr,
          attempts: attempt,
          retryable: true,
        }
      }
      await sleep(NETWORK_RETRY_DELAY_MS * 2 ** (attempt - 1))
    }
  }

  // Unreachable in practice — the loop always returns above. Defensive belt.
  return {
    ok: false,
    status: lastStatus,
    error: lastError,
    attempts: maxAttempts,
    retryable: true,
  }
}

async function readBody(res: Response): Promise<unknown> {
  const ctype = res.headers.get('content-type') ?? ''
  if (ctype.includes('application/json')) {
    try {
      return await res.json()
    } catch {
      return null
    }
  }
  try {
    return await res.text()
  } catch {
    return null
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
