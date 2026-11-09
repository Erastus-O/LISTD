import 'server-only'
import { and, asc, count, eq, gte, inArray, notInArray, or, sql } from 'drizzle-orm'
import { db, jobs, organisationMembers, profiles } from '@/db'
import { INSPECTION_TYPE_LABELS, type InspectionType } from '@/lib/pricing-matrix'

/** "This job was paid for": its escrow settled (held/released), or it has no
 *  escrow row at all (pre-escrow legacy booking / escrow-off environment).
 *  Pending, failed and refunded escrow rows all disqualify. */
function paidOrLegacySql() {
  return sql`(
    exists (
      select 1 from escrow_transactions e
      where e.job_id = ${jobs.id} and e.status in ('held', 'released')
    )
    or not exists (
      select 1 from escrow_transactions e where e.job_id = ${jobs.id}
    )
  )`
}

/**
 * Server-only data layer for the client dashboard headline KPIs + the
 * charts island.
 *
 * Scope rule: the loader respects org membership.
 *   - Org owners see all org jobs (their own + every worker's).
 *   - Solo clients see jobs where `client_id = themselves`.
 *
 * Workers are bounced to `/worker/*` before reaching this surface; their
 * own per-worker numbers live on `/worker/dashboard`.
 */

const ACTIVE_STATUSES = [
  'draft',
  'pending',
  'published',
  'accepted',
  'assigned',
  'in_progress',
] as const

const COMPLETED_STATUSES = [
  'completed',
  'paid',
  'signed',
] as const

const SIGNOFF_PENDING_STATUSES = ['submitted', 'reviewed'] as const

export type ClientDashboardKpi = {
  jobsThisMonth: number
  spendThisMonth: number
  activeJobs: number
  reportsAwaitingSignoff: number
}

export type ClientChartJobsByType = Array<{ name: string; value: number }>
export type ClientChartJobsByStatus = Array<{ status: string; count: number }>
export type ClientChartSpend = Array<{ month: string; spend: number }>

export type ChartWorkerRef = { userId: string; fullName: string | null }

/**
 * Stacked-by-worker chart datasets — returned only for org owners who
 * have at least one worker. The row keys are worker user-ids so recharts
 * can render a series per worker; the `workers` list carries the display
 * name + render order.
 */
export type ClientChartByWorker = {
  workers: ChartWorkerRef[]
  spend: Array<Record<string, number | string>>
  jobsByType: Array<Record<string, number | string>>
}

export type ClientDashboardChartData = {
  jobsByType: ClientChartJobsByType
  jobsByStatus: ClientChartJobsByStatus
  spend: ClientChartSpend
  /** Present only for owners with at least one worker. Solo clients see
   *  null; the chart component falls back to the single-series version. */
  byWorker: ClientChartByWorker | null
}

export type ClientDashboardStats = {
  kpi: ClientDashboardKpi
  chart: ClientDashboardChartData
}

/**
 * Resolves the scoping clause for "jobs visible to this caller":
 *   - Owner of an org → every job under that organisation_id, PLUS the owner's
 *     own bookings. An owner's personal booking isn't always stamped with an
 *     organisation_id (e.g. a solo `/book` flow), so a strict org-only filter
 *     would hide their own completed jobs from their dashboard — exactly the
 *     "0 jobs / £0 spend despite a finished job" symptom. Include client_id.
 *   - Solo client      → jobs where client_id = caller
 *
 * Returns the `where` expression and the `organisationId` (if any) so the
 * caller can use it for sibling queries.
 */
async function resolveScope(userId: string) {
  const [membership] = await db
    .select({
      organisationId: organisationMembers.organisationId,
      orgRole: organisationMembers.orgRole,
    })
    .from(organisationMembers)
    .where(
      and(
        eq(organisationMembers.userId, userId),
        eq(organisationMembers.status, 'active')
      )
    )
    .limit(1)

  if (membership?.orgRole === 'owner') {
    return {
      organisationId: membership.organisationId,
      where: or(
        eq(jobs.organisationId, membership.organisationId),
        eq(jobs.clientId, userId)
      ),
    } as const
  }
  return {
    organisationId: null as string | null,
    where: eq(jobs.clientId, userId),
  } as const
}

export async function loadClientDashboardStats(
  userId: string
): Promise<ClientDashboardStats> {
  const scope = await resolveScope(userId)
  const baseWhere = scope.where

  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    .toISOString()
    .slice(0, 10)

  // ── KPIs ──────────────────────────────────────────────────────────────
  const [jobsThisMonthRow] = await db
    .select({ c: count() })
    .from(jobs)
    .where(and(baseWhere, gte(jobs.createdAt, new Date(monthStart).toISOString())))

  // Spend counts money that actually settled: the job's escrow payment is
  // held/released (paid at booking), OR the job predates escrow entirely
  // (no escrow row — legacy bookings and escrow-off environments). Jobs with
  // only a pending/failed/refunded escrow are NOT spend, and drafts /
  // cancellations are excluded regardless. Same basis as the statement of
  // account's "total spent".
  const NOT_SPEND_STATUSES = ['draft', 'cancelled'] as const
  const spendWhere = and(
    notInArray(jobs.status, [...NOT_SPEND_STATUSES]),
    paidOrLegacySql()
  )

  const [spendThisMonthRow] = await db
    .select({
      // Sum quoted_price as the "committed spend" — final_price is null
      // until admin sets it, but the client has already agreed to the
      // quoted figure at booking time.
      total: sql<string>`coalesce(sum(coalesce(${jobs.finalPrice}, ${jobs.quotedPrice})), 0)`,
    })
    .from(jobs)
    .where(
      and(
        baseWhere,
        spendWhere,
        gte(jobs.createdAt, new Date(monthStart).toISOString())
      )
    )

  const [activeRow] = await db
    .select({ c: count() })
    .from(jobs)
    .where(and(baseWhere, inArray(jobs.status, [...ACTIVE_STATUSES])))

  const [signoffRow] = await db
    .select({ c: count() })
    .from(jobs)
    .where(
      and(
        baseWhere,
        inArray(jobs.status, [...SIGNOFF_PENDING_STATUSES])
      )
    )

  // ── Charts ────────────────────────────────────────────────────────────
  // Jobs by service type (last 90 days)
  const since90 = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
  const typeRows = await db
    .select({ type: jobs.inspectionType, c: count() })
    .from(jobs)
    .where(and(baseWhere, gte(jobs.createdAt, since90)))
    .groupBy(jobs.inspectionType)
  const jobsByType: ClientChartJobsByType = typeRows.map((r) => ({
    name:
      INSPECTION_TYPE_LABELS[r.type as InspectionType] ?? String(r.type),
    value: r.c,
  }))

  // Jobs by current status (all-time snapshot — small N, useful at-a-glance)
  const statusRows = await db
    .select({ status: jobs.status, c: count() })
    .from(jobs)
    .where(baseWhere)
    .groupBy(jobs.status)
  const jobsByStatus: ClientChartJobsByStatus = statusRows
    .map((r) => ({ status: r.status, count: r.c }))
    .sort((a, b) => b.count - a.count)

  // Spend by month (last 6 calendar months including this one)
  const spend: ClientChartSpend = []
  for (let i = 5; i >= 0; i--) {
    const monthDate = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const nextMonthDate = new Date(now.getFullYear(), now.getMonth() - i + 1, 1)
    const monthStartIso = monthDate.toISOString()
    const monthEndIso = nextMonthDate.toISOString()
    const [row] = await db
      .select({
        total: sql<string>`coalesce(sum(coalesce(${jobs.finalPrice}, ${jobs.quotedPrice})), 0)`,
      })
      .from(jobs)
      .where(
        and(
          baseWhere,
          spendWhere,
          gte(jobs.createdAt, monthStartIso),
          sql`${jobs.createdAt} < ${monthEndIso}`
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

  // ── Stacked-by-worker datasets (org owners only) ────────────────────
  const byWorker = scope.organisationId
    ? await loadByWorker(scope.organisationId, now)
    : null

  return {
    kpi: {
      jobsThisMonth: jobsThisMonthRow?.c ?? 0,
      spendThisMonth: Number(spendThisMonthRow?.total ?? 0),
      activeJobs: activeRow?.c ?? 0,
      reportsAwaitingSignoff: signoffRow?.c ?? 0,
    },
    chart: {
      jobsByType,
      jobsByStatus,
      spend,
      byWorker,
    },
  }
}

/**
 * Stacked-by-worker spend (last 6 months) + jobs-by-type (last 90 days).
 *
 * Worker count caps at top 6 by total spend in the window to keep the
 * stack legible — beyond that the colour palette repeats and tooltips
 * become noisy. Surplus volume collapses into "Other" so total numbers
 * still match the single-series version.
 */
async function loadByWorker(
  organisationId: string,
  now: Date
): Promise<ClientChartByWorker | null> {
  const since90 = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
  const since6m = new Date(now.getFullYear(), now.getMonth() - 5, 1).toISOString()

  // Pick the top 6 spenders in the last 6 months. Tiebreak by name so
  // the colour palette stays stable across renders for ties.
  const topSpenders = await db
    .select({
      userId: jobs.createdByUserId,
      fullName: profiles.fullName,
      total: sql<string>`coalesce(sum(coalesce(${jobs.finalPrice}, ${jobs.quotedPrice})), 0)`,
    })
    .from(jobs)
    .leftJoin(profiles, eq(profiles.userId, jobs.createdByUserId))
    .where(
      and(
        eq(jobs.organisationId, organisationId),
        notInArray(jobs.status, ['draft', 'cancelled']),
        paidOrLegacySql(),
        gte(jobs.createdAt, since6m)
      )
    )
    .groupBy(jobs.createdByUserId, profiles.fullName)
    .orderBy(
      sql`coalesce(sum(coalesce(${jobs.finalPrice}, ${jobs.quotedPrice})), 0) desc`,
      asc(profiles.fullName)
    )
    .limit(6)

  if (topSpenders.length === 0) return null

  const workerIds = new Set(
    topSpenders.map((r) => r.userId).filter((id): id is string => Boolean(id))
  )
  const workers: ChartWorkerRef[] = topSpenders
    .filter((r): r is typeof r & { userId: string } => Boolean(r.userId))
    .map((r) => ({ userId: r.userId, fullName: r.fullName }))

  // Spend per worker per month — one row per month, one column per
  // worker user id. Anything outside the top-6 collapses to "other".
  const monthBuckets: Array<{ start: Date; end: Date; label: string }> = []
  for (let i = 5; i >= 0; i--) {
    const start = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1)
    monthBuckets.push({
      start,
      end,
      label: start.toLocaleString('en-GB', {
        month: 'short',
        year: '2-digit',
      }),
    })
  }

  const spendByWorker: Array<Record<string, number | string>> = []
  for (const bucket of monthBuckets) {
    const rows = await db
      .select({
        userId: jobs.createdByUserId,
        total: sql<string>`coalesce(sum(coalesce(${jobs.finalPrice}, ${jobs.quotedPrice})), 0)`,
      })
      .from(jobs)
      .where(
        and(
          eq(jobs.organisationId, organisationId),
          notInArray(jobs.status, ['draft', 'cancelled']),
          paidOrLegacySql(),
          gte(jobs.createdAt, bucket.start.toISOString()),
          sql`${jobs.createdAt} < ${bucket.end.toISOString()}`
        )
      )
      .groupBy(jobs.createdByUserId)
    const monthRow: Record<string, number | string> = { month: bucket.label }
    let other = 0
    for (const r of rows) {
      const amount = Number(r.total)
      if (r.userId && workerIds.has(r.userId)) {
        monthRow[r.userId] = (Number(monthRow[r.userId] ?? 0) || 0) + amount
      } else {
        other += amount
      }
    }
    if (other > 0) monthRow.other = other
    spendByWorker.push(monthRow)
  }

  // Jobs-by-type stacked: rows keyed by inspectionType label, columns
  // are worker user ids in the same top-6 set.
  const typeRows = await db
    .select({
      type: jobs.inspectionType,
      userId: jobs.createdByUserId,
      c: count(),
    })
    .from(jobs)
    .where(
      and(
        eq(jobs.organisationId, organisationId),
        gte(jobs.createdAt, since90)
      )
    )
    .groupBy(jobs.inspectionType, jobs.createdByUserId)
  const typeMap = new Map<string, Record<string, number | string>>()
  for (const r of typeRows) {
    const label =
      INSPECTION_TYPE_LABELS[r.type as InspectionType] ?? String(r.type)
    const row = typeMap.get(label) ?? { type: label }
    if (r.userId && workerIds.has(r.userId)) {
      row[r.userId] = (Number(row[r.userId] ?? 0) || 0) + r.c
    } else {
      row.other = (Number(row.other ?? 0) || 0) + r.c
    }
    typeMap.set(label, row)
  }
  const jobsByTypeStacked = Array.from(typeMap.values())

  return { workers, spend: spendByWorker, jobsByType: jobsByTypeStacked }
}

void COMPLETED_STATUSES
