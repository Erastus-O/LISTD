import 'server-only'
import {
  and,
  count,
  desc,
  eq,
  gte,
  isNotNull,
  sql,
} from 'drizzle-orm'
import {
  auditEvents,
  db,
  jobs,
  organisationMembers,
  profiles,
  properties,
} from '@/db'
import { getSupabaseAdmin } from '@/lib/supabase/admin'

/**
 * Server-only data layer for the per-worker drill-down page at
 * `/client/team/[workerId]`. Returns:
 *
 *   - profile + email + org membership (for the header)
 *   - aggregate stats (total jobs / active / spend / completion %)
 *   - recent jobs (latest 25)
 *   - delivered reports (latest 25)
 *   - 6-month spend trend
 *   - recent activity feed (audit events authored by the worker)
 *
 * Caller is expected to verify the requesting user is the worker's org
 * owner before calling. Returns `null` when no matching worker exists in
 * the org so the page can render a 404.
 */

const ACTIVE_STATUSES = [
  'draft',
  'pending',
  'published',
  'accepted',
  'assigned',
  'in_progress',
] as const

const COMPLETED_STATUSES = ['completed', 'paid', 'signed'] as const

export type WorkerJobRow = {
  id: string
  status: string
  inspectionType: string
  scheduledDate: string
  quotedPrice: string | null
  finalPrice: string | null
  reportUrl: string | null
  propertyAddress: string | null
  propertyPostcode: string | null
}

export type WorkerActivityEntry = {
  id: string
  action: string
  category: string
  createdAt: string
  targetType: string | null
  targetId: string | null
}

export type WorkerSpendPoint = { month: string; spend: number }

export type WorkerDetail = {
  userId: string
  fullName: string | null
  avatarUrl: string | null
  email: string | null
  phone: string | null
  status: string
  invitedAt: string | null
  lastActiveAt: string | null
  organisationId: string
  stats: {
    jobsPosted: number
    activeJobs: number
    totalSpend: number
    completionRatePercent: number | null
    reportsDelivered: number
  }
  recentJobs: WorkerJobRow[]
  recentReports: WorkerJobRow[]
  spendTrend: WorkerSpendPoint[]
  activity: WorkerActivityEntry[]
}

export async function loadWorkerDetail(
  organisationId: string,
  workerUserId: string
): Promise<WorkerDetail | null> {
  // ── Profile + membership ──────────────────────────────────────────────
  const [membership] = await db
    .select({
      organisationId: organisationMembers.organisationId,
      orgRole: organisationMembers.orgRole,
      status: organisationMembers.status,
      invitedAt: organisationMembers.invitedAt,
      lastActiveAt: organisationMembers.lastActiveAt,
      fullName: profiles.fullName,
      avatarUrl: profiles.avatarUrl,
      phone: profiles.phone,
    })
    .from(organisationMembers)
    .leftJoin(profiles, eq(profiles.userId, organisationMembers.userId))
    .where(eq(organisationMembers.userId, workerUserId))
    .limit(1)
  if (!membership || membership.organisationId !== organisationId) {
    return null
  }

  let email: string | null = null
  try {
    const res = await getSupabaseAdmin().auth.admin.getUserById(workerUserId)
    email = res.data?.user?.email ?? null
  } catch {
    email = null
  }

  // ── Stats ─────────────────────────────────────────────────────────────
  const [statsRow] = await db
    .select({
      jobsPosted: count(),
      totalSpend: sql<string>`coalesce(sum(coalesce(${jobs.finalPrice}, ${jobs.quotedPrice})), 0)`,
      active: sql<number>`sum(case when ${jobs.status} = ANY(${sql.raw(
        `ARRAY[${ACTIVE_STATUSES.map((s) => `'${s}'`).join(',')}]::job_status[]`
      )}) then 1 else 0 end)::int`,
      completed: sql<number>`sum(case when ${jobs.status} = ANY(${sql.raw(
        `ARRAY[${COMPLETED_STATUSES.map((s) => `'${s}'`).join(',')}]::job_status[]`
      )}) then 1 else 0 end)::int`,
    })
    .from(jobs)
    .where(eq(jobs.createdByUserId, workerUserId))

  const [reportsRow] = await db
    .select({ c: count() })
    .from(jobs)
    .where(
      and(
        eq(jobs.createdByUserId, workerUserId),
        isNotNull(jobs.reportUrl)
      )
    )

  const jobsPosted = statsRow?.jobsPosted ?? 0
  const completed = Number(statsRow?.completed ?? 0)
  const stats = {
    jobsPosted,
    activeJobs: Number(statsRow?.active ?? 0),
    totalSpend: Number(statsRow?.totalSpend ?? 0),
    completionRatePercent:
      jobsPosted === 0 ? null : Math.round((completed / jobsPosted) * 100),
    reportsDelivered: reportsRow?.c ?? 0,
  }

  // ── Recent jobs + reports ─────────────────────────────────────────────
  const recentJobs = (await db
    .select({
      id: jobs.id,
      status: jobs.status,
      inspectionType: jobs.inspectionType,
      scheduledDate: jobs.scheduledDate,
      quotedPrice: jobs.quotedPrice,
      finalPrice: jobs.finalPrice,
      reportUrl: jobs.reportUrl,
      addressLine1: properties.addressLine1,
      postcode: properties.postcode,
    })
    .from(jobs)
    .leftJoin(properties, eq(properties.id, jobs.propertyId))
    .where(eq(jobs.createdByUserId, workerUserId))
    .orderBy(desc(jobs.scheduledDate))
    .limit(25)
    .then((rows) =>
      rows.map(
        (r): WorkerJobRow => ({
          id: r.id,
          status: r.status,
          inspectionType: r.inspectionType,
          scheduledDate: r.scheduledDate,
          quotedPrice: r.quotedPrice,
          finalPrice: r.finalPrice,
          reportUrl: r.reportUrl,
          propertyAddress: r.addressLine1,
          propertyPostcode: r.postcode,
        })
      )
    ))

  const recentReports = (await db
    .select({
      id: jobs.id,
      status: jobs.status,
      inspectionType: jobs.inspectionType,
      scheduledDate: jobs.scheduledDate,
      quotedPrice: jobs.quotedPrice,
      finalPrice: jobs.finalPrice,
      reportUrl: jobs.reportUrl,
      addressLine1: properties.addressLine1,
      postcode: properties.postcode,
    })
    .from(jobs)
    .leftJoin(properties, eq(properties.id, jobs.propertyId))
    .where(
      and(
        eq(jobs.createdByUserId, workerUserId),
        isNotNull(jobs.reportUrl)
      )
    )
    .orderBy(desc(jobs.scheduledDate))
    .limit(25)
    .then((rows) =>
      rows.map(
        (r): WorkerJobRow => ({
          id: r.id,
          status: r.status,
          inspectionType: r.inspectionType,
          scheduledDate: r.scheduledDate,
          quotedPrice: r.quotedPrice,
          finalPrice: r.finalPrice,
          reportUrl: r.reportUrl,
          propertyAddress: r.addressLine1,
          propertyPostcode: r.postcode,
        })
      )
    ))

  // ── Spend trend (last 6 months) ──────────────────────────────────────
  const now = new Date()
  const spendTrend: WorkerSpendPoint[] = []
  for (let i = 5; i >= 0; i--) {
    const monthDate = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const nextMonthDate = new Date(now.getFullYear(), now.getMonth() - i + 1, 1)
    const [row] = await db
      .select({
        total: sql<string>`coalesce(sum(coalesce(${jobs.finalPrice}, ${jobs.quotedPrice})), 0)`,
      })
      .from(jobs)
      .where(
        and(
          eq(jobs.createdByUserId, workerUserId),
          gte(jobs.createdAt, monthDate.toISOString()),
          sql`${jobs.createdAt} < ${nextMonthDate.toISOString()}`
        )
      )
    spendTrend.push({
      month: monthDate.toLocaleString('en-GB', {
        month: 'short',
        year: '2-digit',
      }),
      spend: Number(row?.total ?? 0),
    })
  }

  // ── Activity feed (recent audit events authored by this worker) ──────
  const activity = await db
    .select({
      id: auditEvents.id,
      action: auditEvents.action,
      category: auditEvents.category,
      createdAt: auditEvents.createdAt,
      targetType: auditEvents.targetType,
      targetId: auditEvents.targetId,
    })
    .from(auditEvents)
    .where(eq(auditEvents.actorUserId, workerUserId))
    .orderBy(desc(auditEvents.createdAt))
    .limit(20)

  return {
    userId: workerUserId,
    fullName: membership.fullName,
    avatarUrl: membership.avatarUrl,
    email,
    phone: membership.phone,
    status: membership.status,
    invitedAt: membership.invitedAt,
    lastActiveAt: membership.lastActiveAt,
    organisationId,
    stats,
    recentJobs,
    recentReports,
    spendTrend,
    activity: activity.map((a) => ({
      id: a.id,
      action: a.action,
      category: a.category,
      createdAt: a.createdAt,
      targetType: a.targetType,
      targetId: a.targetId,
    })),
  }
}

