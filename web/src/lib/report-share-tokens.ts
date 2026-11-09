import 'server-only'
import { createHash, randomBytes } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { db, reportShareTokens, withServiceRole } from '@/db'
import { callerIp, callerUserAgent, logAuditEvent } from '@/lib/audit'

/**
 * Report-share token lifecycle (closes M1 #13).
 *
 * These tokens are different from `tenant_tokens` — they grant a single
 * action (fetch one report PDF) to an unauthenticated third party (a
 * landlord's accountant, an insurer, etc). Lifecycle is:
 *
 *   1. Admin issues at `/admin/generate-report` → row inserted with
 *      `expires_at` (TTL) + optional `max_views` cap.
 *   2. Recipient visits `/reports/share/[token]` → resolver validates,
 *      increments `view_count`, audits, then streams a fresh signed
 *      Supabase URL for the PDF.
 *   3. Admin can revoke any time; expired or capped tokens fail with a
 *      distinct reason so the public page can show a useful error.
 */

export const TTL_OPTIONS_DAYS = [1, 7, 30, 90] as const
export type ShareTtlDays = (typeof TTL_OPTIONS_DAYS)[number]

export type ReportShareTokenRow = typeof reportShareTokens.$inferSelect

export type ShareResolveSuccess = {
  ok: true
  row: ReportShareTokenRow
  jobId: string
}

export type ShareResolveFailure = {
  ok: false
  reason: 'missing' | 'unknown' | 'expired' | 'revoked' | 'view_cap'
}

export type ShareResolveResult = ShareResolveSuccess | ShareResolveFailure

/**
 * Issue a new share token. Returns the raw `token` string the admin
 * should paste / send. The DB stores it as-is; tokens are unguessable
 * (256-bit entropy) so we don't bother with a hash-at-rest scheme for
 * v1 — that's a follow-up if compliance asks.
 */
export async function issueShareToken(params: {
  jobId: string
  label: string | null
  ttlDays: ShareTtlDays
  maxViews: number | null
  issuedBy: string
}): Promise<{ token: string; row: ReportShareTokenRow }> {
  const token = randomBytes(24).toString('base64url')
  const expiresAt = new Date(
    Date.now() + params.ttlDays * 86_400_000
  ).toISOString()

  return withServiceRole(async (tx) => {
    const [row] = await tx
      .insert(reportShareTokens)
      .values({
        jobId: params.jobId,
        token,
        label: params.label ?? null,
        expiresAt,
        maxViews: params.maxViews,
        issuedBy: params.issuedBy,
      })
      .returning()

    await logAuditEvent(tx, {
      category: 'tenant_portal_access',
      action: 'report_share.issued',
      actorUserId: params.issuedBy,
      targetType: 'job',
      targetId: params.jobId,
      payload: {
        tokenHash: hashToken(token),
        ttlDays: params.ttlDays,
        maxViews: params.maxViews,
        label: params.label,
      },
    })

    return { token, row }
  })
}

/**
 * Resolve a public `/reports/share/[token]` request. Validates the row,
 * increments `view_count`, captures IP/UA, and writes a single audit
 * row in `tenant_portal_access`. Returns the row + jobId on success.
 *
 * The caller is responsible for actually serving the PDF — this helper
 * only authorises and audits.
 */
export async function resolveShareToken(
  rawToken: string | null,
  req: Request | undefined
): Promise<ShareResolveResult> {
  if (!rawToken || rawToken.trim() === '') {
    return { ok: false, reason: 'missing' }
  }
  const ip = req ? callerIp(req) : null
  const ua = req ? callerUserAgent(req) : null
  const nowIso = new Date().toISOString()

  return withServiceRole(async (tx) => {
    const [row] = await tx
      .select()
      .from(reportShareTokens)
      .where(eq(reportShareTokens.token, rawToken))
      .limit(1)
    if (!row) return { ok: false, reason: 'unknown' as const }

    if (row.revokedAt) {
      await logAuditEvent(tx, {
        category: 'tenant_portal_access',
        action: 'report_share.access_denied',
        actorUserId: null,
        targetType: 'job',
        targetId: row.jobId,
        payload: {
          tokenHash: hashToken(rawToken),
          reason: 'revoked',
        },
        ipAddress: ip,
        userAgent: ua,
      })
      return { ok: false, reason: 'revoked' as const }
    }
    if (row.expiresAt <= nowIso) {
      await logAuditEvent(tx, {
        category: 'tenant_portal_access',
        action: 'report_share.access_denied',
        actorUserId: null,
        targetType: 'job',
        targetId: row.jobId,
        payload: { tokenHash: hashToken(rawToken), reason: 'expired' },
        ipAddress: ip,
        userAgent: ua,
      })
      return { ok: false, reason: 'expired' as const }
    }
    if (row.maxViews !== null && row.viewCount >= row.maxViews) {
      await logAuditEvent(tx, {
        category: 'tenant_portal_access',
        action: 'report_share.access_denied',
        actorUserId: null,
        targetType: 'job',
        targetId: row.jobId,
        payload: {
          tokenHash: hashToken(rawToken),
          reason: 'view_cap',
          viewCount: row.viewCount,
          maxViews: row.maxViews,
        },
        ipAddress: ip,
        userAgent: ua,
      })
      return { ok: false, reason: 'view_cap' as const }
    }

    // Bump view counter + last-viewed metadata atomically.
    await tx
      .update(reportShareTokens)
      .set({
        viewCount: sql`${reportShareTokens.viewCount} + 1`,
        lastViewedAt: sql`now()`,
        lastViewedIp: ip,
        lastViewedUserAgent: ua,
        updatedAt: sql`now()`,
      })
      .where(eq(reportShareTokens.id, row.id))

    await logAuditEvent(tx, {
      category: 'tenant_portal_access',
      action: 'report_share.viewed',
      actorUserId: null,
      targetType: 'job',
      targetId: row.jobId,
      payload: {
        tokenHash: hashToken(rawToken),
        viewCount: row.viewCount + 1,
        maxViews: row.maxViews,
      },
      ipAddress: ip,
      userAgent: ua,
    })

    return { ok: true, row, jobId: row.jobId }
  })
}

/**
 * Admin revocation. Idempotent on already-revoked.
 */
export async function revokeShareToken(params: {
  tokenId: string
  by: string
  reason: string | null
}): Promise<void> {
  await withServiceRole(async (tx) => {
    const [row] = await tx
      .select()
      .from(reportShareTokens)
      .where(eq(reportShareTokens.id, params.tokenId))
      .limit(1)
    if (!row) return
    if (row.revokedAt) return // idempotent

    await tx
      .update(reportShareTokens)
      .set({
        revokedAt: sql`now()`,
        revokedBy: params.by,
        revokedReason: params.reason,
        updatedAt: sql`now()`,
      })
      .where(eq(reportShareTokens.id, params.tokenId))

    await logAuditEvent(tx, {
      category: 'tenant_portal_access',
      action: 'report_share.revoked',
      actorUserId: params.by,
      targetType: 'job',
      targetId: row.jobId,
      payload: {
        tokenHash: hashToken(row.token),
        reason: params.reason,
      },
    })
  })
}

/**
 * Read-only list of every active share token for a job. Drives the
 * admin "manage shares" surface.
 */
export async function listShareTokensForJob(jobId: string) {
  return db
    .select()
    .from(reportShareTokens)
    .where(eq(reportShareTokens.jobId, jobId))
}

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex').slice(0, 16)
}
