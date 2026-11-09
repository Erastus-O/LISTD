import 'server-only'
import { auditEvents, type Tx } from '@/db'

/**
 * Append-only audit trail (M1 #22 Package A). One canonical helper used by
 * every state-transition site (job lifecycle, verification, impersonation,
 * pricing override, strike, platform-setting, tenant-portal access).
 *
 * **Call inside the same transaction as the row mutation it logs.** Partial
 * failures must not produce a "mutation without audit row" condition.
 *
 * The 18-site wiring plan and per-site `(category, action, payload)` shape
 * is in [Docs/M1-Audit-Events-Review.md](../../../Docs/M1-Audit-Events-Review.md) §4.
 */
export type AuditCategory =
  | 'job_lifecycle'
  | 'verification'
  | 'impersonation'
  | 'pricing_override'
  | 'strike'
  | 'platform_setting'
  | 'tenant_portal_access'
  | 'account_status'
  | 'dispute'
  | 'billing'

export type LogAuditEventParams = {
  category: AuditCategory
  /** Dot-namespaced action, e.g. `job.published`, `verification.approved`. */
  action: string
  /** Acting user. `null` for cron / system / external (set `payload.actor` to clarify). */
  actorUserId: string | null
  /** Domain entity touched, e.g. `'job'`, `'profile'`, `'organisation'`. */
  targetType?: string
  /** UUID or external id of the target row, kept as text for flexibility. */
  targetId?: string | null
  /** Free-form context — before/after diff, decision reason, idempotency keys, etc. */
  payload?: Record<string, unknown>
  /** Best-effort caller IP from `x-forwarded-for` (right-most untrusted). */
  ipAddress?: string | null
  userAgent?: string | null
}

export async function logAuditEvent(
  tx: Tx,
  params: LogAuditEventParams
): Promise<void> {
  await tx.insert(auditEvents).values({
    category: params.category,
    action: params.action,
    actorUserId: params.actorUserId,
    targetType: params.targetType ?? null,
    targetId: params.targetId ?? null,
    payload: params.payload ?? {},
    ipAddress: params.ipAddress ?? null,
    userAgent: params.userAgent ?? null,
  })
}

/**
 * Pull the best-effort caller IP from a Request, honouring the standard
 * proxy headers Vercel sets. Use at route-handler boundaries; pass the
 * result into `logAuditEvent` so the audit row carries the network
 * provenance, not just the application-level actor.
 */
export function callerIp(req: Request): string | null {
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) {
    // First in the list is the original client; the rest are proxies.
    const first = fwd.split(',')[0]?.trim()
    if (first) return first
  }
  return req.headers.get('x-real-ip')
}

export function callerUserAgent(req: Request): string | null {
  return req.headers.get('user-agent')
}
