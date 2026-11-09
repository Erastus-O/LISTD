import 'server-only'
import { and, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm'
import { auditEvents, db, profiles } from '@/db'

/**
 * Read-side data layer for the admin **Activity log** — a global, filterable
 * view of every `audit_events` row across the platform (who did what, when,
 * from where). Admin-gated at the page; RLS also restricts to admins.
 */

export const AUDIT_CATEGORIES = [
  'job_lifecycle',
  'verification',
  'impersonation',
  'pricing_override',
  'strike',
  'platform_setting',
  'tenant_portal_access',
  'account_status',
  'dispute',
  'billing',
] as const

export const PAGE_SIZE = 50

export type ActivityLogFilter = {
  q?: string
  category?: string
  targetType?: string
  from?: string
  to?: string
  page: number
}

export type ActivityLogRow = {
  id: string
  category: string
  action: string
  actorUserId: string | null
  actorName: string | null
  targetType: string | null
  targetId: string | null
  payload: Record<string, unknown>
  ipAddress: string | null
  createdAt: string
}

export type ActivityLogData = {
  rows: ActivityLogRow[]
  total: number
  page: number
  pageCount: number
}

function buildWhere(f: ActivityLogFilter): SQL<unknown> | undefined {
  const clauses: SQL<unknown>[] = []
  if (f.category) {
    // Enum column compared as text (avoids `enum = text` operator errors).
    clauses.push(sql`${auditEvents.category}::text = ${f.category}`)
  }
  if (f.targetType) clauses.push(eq(auditEvents.targetType, f.targetType))
  if (f.from) {
    clauses.push(sql`${auditEvents.createdAt} >= ${f.from}::timestamptz`)
  }
  if (f.to) {
    clauses.push(
      sql`${auditEvents.createdAt} <= ${`${f.to}T23:59:59.999Z`}::timestamptz`
    )
  }
  if (f.q) {
    const like = `%${f.q}%`
    const term = or(
      ilike(auditEvents.action, like),
      ilike(auditEvents.targetId, like),
      ilike(profiles.fullName, like),
      ilike(profiles.companyName, like)
    )
    if (term) clauses.push(term)
  }
  return clauses.length > 0 ? and(...clauses) : undefined
}

export async function loadActivityLog(
  filter: ActivityLogFilter
): Promise<ActivityLogData> {
  const where = buildWhere(filter)
  const offset = (filter.page - 1) * PAGE_SIZE

  const [rows, [{ count }]] = await Promise.all([
    db
      .select({
        id: auditEvents.id,
        category: auditEvents.category,
        action: auditEvents.action,
        actorUserId: auditEvents.actorUserId,
        actorName: profiles.fullName,
        actorCompany: profiles.companyName,
        targetType: auditEvents.targetType,
        targetId: auditEvents.targetId,
        payload: auditEvents.payload,
        ipAddress: auditEvents.ipAddress,
        createdAt: auditEvents.createdAt,
      })
      .from(auditEvents)
      .leftJoin(profiles, eq(profiles.userId, auditEvents.actorUserId))
      .where(where)
      .orderBy(desc(auditEvents.createdAt))
      .limit(PAGE_SIZE)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(auditEvents)
      .leftJoin(profiles, eq(profiles.userId, auditEvents.actorUserId))
      .where(where),
  ])

  return {
    rows: rows.map((r) => ({
      id: r.id,
      category: r.category as string,
      action: r.action,
      actorUserId: r.actorUserId,
      actorName: r.actorName ?? r.actorCompany ?? null,
      targetType: r.targetType,
      targetId: r.targetId,
      payload: (r.payload ?? {}) as Record<string, unknown>,
      ipAddress: r.ipAddress,
      createdAt: r.createdAt,
    })),
    total: count,
    page: filter.page,
    pageCount: Math.max(1, Math.ceil(count / PAGE_SIZE)),
  }
}

export function parseActivityLogFilter(
  sp: Record<string, string | string[] | undefined>
): ActivityLogFilter {
  const first = (v: string | string[] | undefined) =>
    (Array.isArray(v) ? v[0] : v)?.trim() || undefined
  const cat = first(sp.category)
  const pageRaw = parseInt(first(sp.page) ?? '1', 10)
  return {
    q: first(sp.q),
    category:
      cat && (AUDIT_CATEGORIES as readonly string[]).includes(cat)
        ? cat
        : undefined,
    targetType: first(sp.target),
    from: /^\d{4}-\d{2}-\d{2}$/.test(first(sp.from) ?? '')
      ? first(sp.from)
      : undefined,
    to: /^\d{4}-\d{2}-\d{2}$/.test(first(sp.to) ?? '') ? first(sp.to) : undefined,
    page: Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1,
  }
}
