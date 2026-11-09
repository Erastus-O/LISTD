import 'server-only'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { auditEvents, db, profiles } from '@/db'

/**
 * Read-side helpers for the `audit_events` table (M1 #22). Companion to
 * [audit.ts](./audit.ts) which is the write helper. Used by admin surfaces
 * to surface the trail (S6c-3 — admin job detail audit-trail card).
 *
 * Always called from admin-gated server components / route handlers. RLS
 * would also gate this via "Admins can view all audit events", but using
 * `db` directly (no service-role tx) is fine — admin-gated reads land here.
 */

export type AuditTrailEntry = {
  id: string
  category: string
  action: string
  actorUserId: string | null
  /** Resolved actor display name (profiles.fullName); null for system / cron rows. */
  actorName: string | null
  payload: Record<string, unknown>
  ipAddress: string | null
  createdAt: string
}

/**
 * Load the audit trail for a single job, newest first. Joins to `profiles`
 * to resolve actor display names in one query (small N — capped at `limit`).
 *
 * Pass any `targetType` other than `'job'` and the row will simply not match.
 * If the surface ever needs profile / dispute / strike trails the same shape
 * works — just call with `targetType='profile'` etc.
 */
export async function loadAuditTrail(
  targetType: string,
  targetId: string,
  limit = 50
): Promise<AuditTrailEntry[]> {
  const rows = await db
    .select({
      id: auditEvents.id,
      category: auditEvents.category,
      action: auditEvents.action,
      actorUserId: auditEvents.actorUserId,
      payload: auditEvents.payload,
      ipAddress: auditEvents.ipAddress,
      createdAt: auditEvents.createdAt,
    })
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.targetType, targetType),
        eq(auditEvents.targetId, targetId)
      )
    )
    .orderBy(desc(auditEvents.createdAt))
    .limit(limit)

  if (rows.length === 0) return []

  const actorIds = Array.from(
    new Set(rows.map((r) => r.actorUserId).filter((id): id is string => Boolean(id)))
  )
  const actorRows =
    actorIds.length === 0
      ? []
      : await db
          .select({ userId: profiles.userId, fullName: profiles.fullName })
          .from(profiles)
          .where(inArray(profiles.userId, actorIds))
  const actorMap = new Map(
    actorRows.map((r) => [r.userId, r.fullName ?? null])
  )

  return rows.map((r) => ({
    id: r.id,
    category: r.category as string,
    action: r.action,
    actorUserId: r.actorUserId,
    actorName: r.actorUserId ? actorMap.get(r.actorUserId) ?? null : null,
    payload: (r.payload ?? {}) as Record<string, unknown>,
    ipAddress: r.ipAddress,
    createdAt: r.createdAt,
  }))
}

export const loadJobAuditTrail = (jobId: string, limit?: number) =>
  loadAuditTrail('job', jobId, limit)
