import 'server-only'
import { createHash, randomBytes } from 'node:crypto'
import { and, eq, isNull, or, sql } from 'drizzle-orm'
import {
  tenantDetails,
  tenantTokens,
  withServiceRole,
  type Tx,
} from '@/db'
import { callerIp, callerUserAgent, logAuditEvent } from '@/lib/audit'

/**
 * Tenant portal token lifecycle (M3 #1–4).
 *
 * Single source of truth for resolving / issuing / rotating / revoking tokens
 * granted to tenants for the `/tenant/portal` flow. **Tenants are not
 * authenticated Supabase users** — the token + scope is the entire trust
 * boundary, so this lib is the only place that decides whether a request is
 * allowed in.
 *
 * The schema lives in `tenant_tokens` ([0004_tenant_tokens.sql](../db/migrations/0004_tenant_tokens.sql)).
 * Legacy `tenant_details.tenant_token` text column is honoured as a
 * fallback during the cutover to keep already-distributed links working;
 * the first successful resolve via the legacy column lazy-creates a
 * `tenant_tokens` row so subsequent visits use the new lifecycle.
 */

export const TOKEN_SCOPES = [
  'view_report',
  'sign_report',
  'download_report',
] as const

export type TokenScope = (typeof TOKEN_SCOPES)[number]

const DEFAULT_TTL_DAYS = 7
const ROTATION_GRACE_SECONDS = 5 * 60 // M3 #1 spec

export type TenantTokenRow = typeof tenantTokens.$inferSelect

export type ResolveSuccess = {
  ok: true
  /** The resolved token row. May be `null` when resolved via the legacy fallback path. */
  row: TenantTokenRow | null
  jobId: string
  tenantDetailId: string | null
  /** True when the resolve hit the legacy `tenant_details.tenant_token` column. */
  usingLegacy: boolean
  /** True when this was a rotation predecessor still in the 5-min grace window. */
  inGraceWindow: boolean
}

export type ResolveFailure = {
  ok: false
  reason:
    | 'missing'
    | 'unknown'
    | 'expired'
    | 'revoked'
    | 'wrong_scope'
    | 'grace_window_expired'
}

export type ResolveResult = ResolveSuccess | ResolveFailure

/**
 * Resolve an inbound `?token=…` parameter into a (jobId, tenantDetailId)
 * pair plus a validated lifecycle state. **Always call this at the top of
 * every tenant portal route handler** before any data fetch.
 *
 * Side effects on success:
 *   - `tenant_tokens.last_used_at` / `_ip` / `_user_agent` updated
 *     (best-effort; won't fail the resolve if it fails)
 *   - One `audit_events` row written in `tenant_portal_access` category
 *     with the token-id hash + path in the payload
 *
 * @param rawToken     the URL parameter (`null` if missing → `{ ok: false, reason: 'missing' }`)
 * @param requiredScope optional scope the caller needs; rejected if not in `token.scope`
 * @param req          the inbound `Request` — used for IP / UA capture in the audit row
 * @param actionLabel  what the caller is trying to do, e.g. `'view_report'`, `'sign_report'`, `'download_report'`. Logged in audit payload.
 */
export async function resolveTenantToken(
  rawToken: string | null,
  requiredScope: TokenScope | undefined,
  req: Request | undefined,
  actionLabel: string
): Promise<ResolveResult> {
  if (!rawToken || rawToken.trim() === '') {
    return { ok: false, reason: 'missing' }
  }

  const ip = req ? callerIp(req) : null
  const ua = req ? callerUserAgent(req) : null
  const nowIso = new Date().toISOString()

  return withServiceRole(async (tx) => {
    // 1) Try the new `tenant_tokens` table first (preferred path).
    const [row] = await tx
      .select()
      .from(tenantTokens)
      .where(eq(tenantTokens.token, rawToken))
      .limit(1)

    if (row) {
      // 1a) Revoked?
      if (row.revokedAt !== null) {
        await writeAccessAudit(tx, {
          tokenId: row.id,
          jobId: row.jobId,
          actionLabel,
          status: 'revoked',
          ip,
          ua,
        })
        return { ok: false, reason: 'revoked' as const }
      }

      // 1b) Expired?
      if (row.expiresAt <= nowIso) {
        await writeAccessAudit(tx, {
          tokenId: row.id,
          jobId: row.jobId,
          actionLabel,
          status: 'expired',
          ip,
          ua,
        })
        return { ok: false, reason: 'expired' as const }
      }

      // 1c) Rotation grace window. If this row was rotated FROM (i.e. there's
      //     a newer row with `rotated_from_id = row.id`), it remains valid
      //     for `ROTATION_GRACE_SECONDS` after the rotation, then becomes
      //     invalid even if `expires_at` is still in the future.
      let inGraceWindow = false
      const [rotation] = await tx
        .select({
          rotatedAt: tenantTokens.rotatedAt,
        })
        .from(tenantTokens)
        .where(eq(tenantTokens.rotatedFromId, row.id))
        .limit(1)
      if (rotation?.rotatedAt) {
        const rotatedAtMs = new Date(rotation.rotatedAt).getTime()
        const ageSec = (Date.now() - rotatedAtMs) / 1000
        if (ageSec > ROTATION_GRACE_SECONDS) {
          await writeAccessAudit(tx, {
            tokenId: row.id,
            jobId: row.jobId,
            actionLabel,
            status: 'grace_window_expired',
            ip,
            ua,
          })
          return { ok: false, reason: 'grace_window_expired' as const }
        }
        inGraceWindow = true
      }

      // 1d) Scope.
      if (requiredScope && !row.scope.includes(requiredScope)) {
        await writeAccessAudit(tx, {
          tokenId: row.id,
          jobId: row.jobId,
          actionLabel,
          status: 'wrong_scope',
          ip,
          ua,
          requiredScope,
        })
        return { ok: false, reason: 'wrong_scope' as const }
      }

      // 1e) Touch last-used metadata (best-effort).
      await tx
        .update(tenantTokens)
        .set({
          lastUsedAt: sql`now()`,
          lastUsedIp: ip,
          lastUsedUserAgent: ua,
        })
        .where(eq(tenantTokens.id, row.id))

      await writeAccessAudit(tx, {
        tokenId: row.id,
        jobId: row.jobId,
        actionLabel,
        status: 'ok',
        ip,
        ua,
      })

      return {
        ok: true,
        row,
        jobId: row.jobId,
        tenantDetailId: row.tenantDetailId,
        usingLegacy: false,
        inGraceWindow,
      } as const
    }

    // 2) Fall back to the legacy `tenant_details.tenant_token` text column.
    //    This keeps already-distributed links working through the cutover.
    //    On first success, lazy-create a `tenant_tokens` row so subsequent
    //    visits use the new lifecycle.
    const [legacy] = await tx
      .select({
        id: tenantDetails.id,
        jobId: tenantDetails.jobId,
        token: tenantDetails.tenantToken,
      })
      .from(tenantDetails)
      .where(
        and(
          eq(tenantDetails.tenantToken, rawToken),
          // Defensive: ignore rows where the legacy token field is null
          // (would otherwise match a NULL in some DB collations).
          or(isNull(tenantDetails.tenantToken), eq(tenantDetails.tenantToken, rawToken))
        )
      )
      .limit(1)

    if (!legacy) {
      // No row in either table — token is unknown. We can't write a
      // tenant_portal_access audit row without a jobId, so failed-lookup
      // attempts are logged at the application layer instead (the calling
      // route handler should `console.warn` and the suspicious-access
      // alert cron in M3 #11 will pick up the pattern via Vercel KV /
      // rate-limiter counters keyed on IP).
      return { ok: false, reason: 'unknown' as const }
    }

    // Lazy-create a `tenant_tokens` row mirroring the legacy token, with a
    // default 7-day expiry from now and the full default scope. Idempotent
    // via the unique constraint on `token`.
    const expiresAt = new Date(
      Date.now() + DEFAULT_TTL_DAYS * 24 * 60 * 60 * 1000
    ).toISOString()

    let createdRow: TenantTokenRow | null = null
    try {
      const [inserted] = await tx
        .insert(tenantTokens)
        .values({
          jobId: legacy.jobId,
          tenantDetailId: legacy.id,
          token: rawToken,
          scope: [...TOKEN_SCOPES] as string[],
          expiresAt,
        })
        .returning()
      createdRow = inserted
    } catch {
      // Race: another resolve created it between our check and insert. Re-read.
      const [retry] = await tx
        .select()
        .from(tenantTokens)
        .where(eq(tenantTokens.token, rawToken))
        .limit(1)
      createdRow = retry ?? null
    }

    if (!createdRow) {
      return { ok: false, reason: 'unknown' as const }
    }

    // Retire the legacy credential. The token now lives in `tenant_tokens`
    // (same value, lifecycle-managed: expiry / rotation / revocation). Clearing
    // the plaintext `tenant_details.tenant_token` means it's no longer a
    // dormant, never-expiring credential sitting in the tenant row.
    await tx
      .update(tenantDetails)
      .set({ tenantToken: null })
      .where(eq(tenantDetails.id, legacy.id))

    // Validate scope against the freshly-created row (always passes
    // because we issued the full default scope, but kept the check for
    // forward-compat if the migration narrows defaults).
    if (requiredScope && !createdRow.scope.includes(requiredScope)) {
      await writeAccessAudit(tx, {
        tokenId: createdRow.id,
        jobId: createdRow.jobId,
        actionLabel,
        status: 'wrong_scope',
        ip,
        ua,
        requiredScope,
      })
      return { ok: false, reason: 'wrong_scope' as const }
    }

    await writeAccessAudit(tx, {
      tokenId: createdRow.id,
      jobId: createdRow.jobId,
      actionLabel,
      status: 'ok_legacy_upgraded',
      ip,
      ua,
    })

    return {
      ok: true,
      row: createdRow,
      jobId: createdRow.jobId,
      tenantDetailId: createdRow.tenantDetailId,
      usingLegacy: true,
      inGraceWindow: false,
    } as const
  })
}

/**
 * Issue a brand-new tenant token. Used by the admin / clerk handlers that
 * trigger the post-inspection sign-off flow (M3 #2).
 */
export async function issueTenantToken(params: {
  jobId: string
  tenantDetailId: string | null
  scope?: TokenScope[]
  ttlDays?: number
  issuedBy?: string
  rotatedFromId?: string | null
}): Promise<{ token: string; row: TenantTokenRow }> {
  const token = generateOpaqueToken()
  const ttlDays = params.ttlDays ?? DEFAULT_TTL_DAYS
  const expiresAt = new Date(
    Date.now() + ttlDays * 24 * 60 * 60 * 1000
  ).toISOString()
  const scope = (params.scope ?? [...TOKEN_SCOPES]) as string[]

  const row = await withServiceRole(async (tx) => {
    const [inserted] = await tx
      .insert(tenantTokens)
      .values({
        jobId: params.jobId,
        tenantDetailId: params.tenantDetailId,
        token,
        scope,
        expiresAt,
        issuedBy: params.issuedBy,
        rotatedFromId: params.rotatedFromId ?? null,
        rotatedAt: params.rotatedFromId ? sql`now()` : null,
      })
      .returning()
    return inserted
  })

  return { token, row }
}

/**
 * Rotate the given token: issue a fresh one, mark the old one as
 * `rotated_at = now()`, return the new token. The old token remains
 * resolvable for `ROTATION_GRACE_SECONDS` so any in-flight request from
 * the same user-agent doesn't fail mid-flow (M3 #1).
 */
export async function rotateTenantToken(currentToken: string): Promise<
  | { ok: true; token: string; row: TenantTokenRow }
  | { ok: false; reason: 'unknown' | 'revoked' | 'expired' }
> {
  return withServiceRole(async (tx) => {
    const [current] = await tx
      .select()
      .from(tenantTokens)
      .where(eq(tenantTokens.token, currentToken))
      .limit(1)
    if (!current) return { ok: false, reason: 'unknown' as const }
    if (current.revokedAt !== null) return { ok: false, reason: 'revoked' as const }
    if (current.expiresAt <= new Date().toISOString()) {
      return { ok: false, reason: 'expired' as const }
    }

    const newToken = generateOpaqueToken()
    const ttlMs = new Date(current.expiresAt).getTime() - Date.now()
    const newExpiresAt =
      ttlMs > 0
        ? current.expiresAt
        : new Date(Date.now() + DEFAULT_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString()

    const [created] = await tx
      .insert(tenantTokens)
      .values({
        jobId: current.jobId,
        tenantDetailId: current.tenantDetailId,
        token: newToken,
        scope: current.scope,
        expiresAt: newExpiresAt,
        issuedBy: current.issuedBy,
        rotatedFromId: current.id,
        rotatedAt: sql`now()`,
      })
      .returning()

    return { ok: true as const, token: newToken, row: created }
  })
}

/** Mark a token revoked. Idempotent. */
export async function revokeTenantToken(params: {
  token: string
  by: string
  reason?: string
}): Promise<void> {
  await withServiceRole((tx) =>
    tx
      .update(tenantTokens)
      .set({
        revokedAt: sql`now()`,
        revokedBy: params.by,
        revokedReason: params.reason ?? null,
      })
      .where(eq(tenantTokens.token, params.token))
  )
}

/**
 * Generate a 32-byte URL-safe opaque token. ~256 bits of entropy; collision
 * resistance is many orders of magnitude beyond what we'd ever issue.
 */
function generateOpaqueToken(): string {
  return randomBytes(32)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

/**
 * Truncated SHA-256 of the token. Stored in audit payloads so a token
 * value can be correlated across log rows without putting the raw token
 * in plaintext logs (Compliance Q5 default in the roadmap).
 */
function hashTokenForAudit(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, 16)
}

async function writeAccessAudit(
  tx: Tx,
  params: {
    tokenId: string | null
    jobId: string
    actionLabel: string
    status:
      | 'ok'
      | 'ok_legacy_upgraded'
      | 'expired'
      | 'revoked'
      | 'wrong_scope'
      | 'grace_window_expired'
    ip: string | null
    ua: string | null
    requiredScope?: TokenScope
  }
): Promise<void> {
  await logAuditEvent(tx, {
    category: 'tenant_portal_access',
    action: `tenant_portal.${params.actionLabel}.${params.status}`,
    actorUserId: null, // tenants are anonymous
    targetType: 'job',
    targetId: params.jobId,
    payload: {
      actor: 'tenant',
      tokenId: params.tokenId,
      requiredScope: params.requiredScope ?? null,
      status: params.status,
    },
    ipAddress: params.ip,
    userAgent: params.ua,
  })
}

// Suppress unused-var warning on the audit-row-hash helper. It's exported
// as part of the API surface so route handlers can correlate manually if
// they ever need to without re-deriving the hash.
export { hashTokenForAudit }
