import 'server-only'
import { desc, eq, inArray } from 'drizzle-orm'
import {
  db,
  userRoles,
  withServiceRole,
  xeroConnections,
} from '@/db'
import {
  XERO_TOKEN_URL,
  type XeroAccess,
} from '@/lib/xero'

/**
 * Provider-level Xero access. The existing per-user helper in `lib/xero.ts`
 * assumes a logged-in user is acting on their own connection (the original
 * `/api/xero/invoices` flow). The `BillingProvider` abstraction is the
 * other way around: the platform itself bills, so we need a single Xero
 * connection that all admin-initiated calls flow through.
 *
 * Resolution order:
 *   1. `XERO_OWNER_USER_ID` env var — explicit pin. Recommended for prod
 *      so connection ownership doesn't drift when admins come and go.
 *   2. The most-recently-connected admin's row.
 *
 * Throws if no admin has connected yet — caller should surface this as a
 * "Connect Xero from /admin/settings/billing" message. (The connect flow
 * itself lives at /api/xero/authorize, already shipped.)
 */
export async function getXeroProviderAccess(): Promise<XeroAccess> {
  const clientId = process.env.XERO_CLIENT_ID
  const clientSecret = process.env.XERO_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    throw new Error('Xero credentials not configured on server.')
  }

  const ownerUserId = process.env.XERO_OWNER_USER_ID?.trim()
  const connection = await withServiceRole(async (tx) => {
    if (ownerUserId) {
      const [row] = await tx
        .select()
        .from(xeroConnections)
        .where(eq(xeroConnections.userId, ownerUserId))
        .orderBy(desc(xeroConnections.connectedAt))
        .limit(1)
      if (row) return row
    }
    // Fallback: most-recently-connected admin.
    const admins = await tx
      .select({ userId: userRoles.userId })
      .from(userRoles)
      .where(eq(userRoles.role, 'admin'))
    if (admins.length === 0) return null
    const adminIds = admins.map((a) => a.userId)
    const [row] = await tx
      .select()
      .from(xeroConnections)
      .where(inArray(xeroConnections.userId, adminIds))
      .orderBy(desc(xeroConnections.connectedAt))
      .limit(1)
    return row ?? null
  })

  if (!connection) {
    throw new Error(
      'No Xero connection on file. An admin must connect Xero before invoices route through this provider.'
    )
  }

  const expiresAtMs = new Date(connection.tokenExpiresAt).getTime()
  if (Date.now() < expiresAtMs - 60_000) {
    return {
      accessToken: connection.accessToken,
      tenantId: connection.tenantId,
    }
  }

  // Refresh — mirrors the per-user implementation but writes back via
  // service role.
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
    console.error('[xero/billing access] token refresh failed:', errText)
    throw new Error(
      'Failed to refresh Xero token. The admin must reconnect Xero from /admin/settings/billing.'
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

/**
 * Cheap predicate — does anyone have a Xero connection? Used by the
 * settings page to decide whether to render "Connect Xero" CTA.
 */
export async function isXeroConnected(): Promise<boolean> {
  const ownerUserId = process.env.XERO_OWNER_USER_ID?.trim()
  if (ownerUserId) {
    const [row] = await db
      .select({ id: xeroConnections.id })
      .from(xeroConnections)
      .where(eq(xeroConnections.userId, ownerUserId))
      .limit(1)
    return !!row
  }
  const admins = await db
    .select({ userId: userRoles.userId })
    .from(userRoles)
    .where(eq(userRoles.role, 'admin'))
  if (admins.length === 0) return false
  const [row] = await db
    .select({ id: xeroConnections.id })
    .from(xeroConnections)
    .where(
      inArray(
        xeroConnections.userId,
        admins.map((a) => a.userId)
      )
    )
    .limit(1)
  return !!row
}
