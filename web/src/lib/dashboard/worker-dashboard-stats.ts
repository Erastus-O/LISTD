import 'server-only'
import {
  and,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  sql,
} from 'drizzle-orm'
import { auditEvents, db, jobs } from '@/db'
import { INSPECTION_TYPE_LABELS, type InspectionType } from '@/lib/pricing-matrix'

/**
 * Server-only data layer for `/worker/dashboard`. Mirrors the client
 * dashboard shape at smaller scale, scoped to `created_by_user_id =
 * workerId` instead of `client_id` — workers see only what they
 * personally posted, not the wider org backlog.
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

export type WorkerDashboardKpi = {
  jobsThisMonth: number
  spendThisMonth: number
  activeJobs: number
  reportsDelivered: number
}

export type WorkerChartJobsByType = Array<{ name: string; value: number }>
export type WorkerChartJobsByStatus = Array<{ status: string; count: number }>
export type WorkerChartSpend = Array<{ month: string; spend: number }>

export type WorkerActivityEntry = {
  id: string
  action: string
  category: string
  createdAt: string
  targetType: string | null
  targetId: string | null
}

export type WorkerDashboardStats = {
  kpi: WorkerDashboardKpi
  chart: {
    spend: WorkerChartSpend
    jobsByType: WorkerChartJobsByType
    jobsByStatus: WorkerChartJobsByStatus
  }
  activity: WorkerActivityEntry[]
}

export async function loadWorkerDashboardStats(
  workerId: string
): Promise<WorkerDashboardStats> {
  const baseWhere = eq(jobs.createdByUserId, workerId)
  const now = new Date()
  const monthStartIso = new Date(
    now.getFullYear(),
    now.getMonth(),
    1
  ).toISOString()

  // ── KPIs ──────────────────────────────────────────────────────────────
  const [jobsThisMonthRow] = await db
    .select({ c: count() })
    .from(jobs)
    .where(and(baseWhere, gte(jobs.createdAt, monthStartIso)))

  const [spendThisMonthRow] = await db
    .select({
      total: sql<string>`coalesce(sum(coalesce(${jobs.finalPrice}, ${jobs.quotedPrice})), 0)`,
    })
    .from(jobs)
    .where(and(baseWhere, gte(jobs.createdAt, monthStartIso)))

  const [activeRow] = await db
    .select({ c: count() })
    .from(jobs)
    .where(and(baseWhere, inArray(jobs.status, [...ACTIVE_STATUSES])))

  const [reportsRow] = await db
    .select({ c: count() })
    .from(jobs)
    .where(and(baseWhere, isNotNull(jobs.reportUrl)))

  // ── Charts ────────────────────────────────────────────────────────────
  // Jobs by service type (last 90 days)
  const since90 = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
  const typeRows = await db
    .select({ type: jobs.inspectionType, c: count() })
    .from(jobs)
    .where(and(baseWhere, gte(jobs.createdAt, since90)))
    .groupBy(jobs.inspectionType)
  const jobsByType: WorkerChartJobsByType = typeRows.map((r) => ({
    name:
      INSPECTION_TYPE_LABELS[r.type as InspectionType] ?? String(r.type),
    value: r.c,
  }))

  // Jobs by current status — small N, useful at-a-glance
  const statusRows = await db
    .select({ status: jobs.status, c: count() })
    .from(jobs)
    .where(baseWhere)
    .groupBy(jobs.status)
  const jobsByStatus: WorkerChartJobsByStatus = statusRows
    .map((r) => ({ status: r.status, count: r.c }))
    .sort((a, b) => b.count - a.count)

  // Spend by month (last 6 calendar months)
  const spend: WorkerChartSpend = []
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
          baseWhere,
          gte(jobs.createdAt, monthDate.toISOString()),
          sql`${jobs.createdAt} < ${nextMonthDate.toISOString()}`
        )
      )
    spend.push({
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
    .where(eq(auditEvents.actorUserId, workerId))
    .orderBy(desc(auditEvents.createdAt))
    .limit(10)

  return {
    kpi: {
      jobsThisMonth: jobsThisMonthRow?.c ?? 0,
      spendThisMonth: Number(spendThisMonthRow?.total ?? 0),
      activeJobs: activeRow?.c ?? 0,
      reportsDelivered: reportsRow?.c ?? 0,
    },
    chart: { spend, jobsByType, jobsByStatus },
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

void COMPLETED_STATUSES
