import 'server-only'
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  not,
  sql,
} from 'drizzle-orm'
import { db, invoices, jobs, profiles, properties, reports } from '@/db'
import { cacheKey, getOrSet } from '@/lib/cache'
import { type InspectionType, INSPECTION_TYPE_LABELS } from '@/lib/pricing-matrix'

/**
 * Server-only data layer for the admin Dashboard (Lovable port equivalent of
 * AdminDashboard.tsx). Computes 8 KPIs, 5 chart datasets, and an alerts list
 * in **one transaction** so the page renders from a single round-trip
 * (Lovable issued ~12 separate `supabase.from(...)` calls in parallel from
 * the client; here we run them inside one server-side tx and ship pre-baked
 * datasets to the chart islands).
 *
 * The acceptance-rate threshold (≤6h) and document-expiry window (30 days)
 * are kept as inline constants since they're matched by Lovable's KPI thresholds
 * — see `src/pages/admin/AdminDashboard.tsx`.
 *
 * Queries are intentionally read-only and admin-gated at the page level.
 */

const REVENUE_STATUSES = ['completed', 'paid', 'signed'] as const
const PAYOUT_PENDING_STATUSES = [
  'completed',
  'signed',
  'reviewed',
  'submitted',
] as const
const ACTIVE_CLERK_STATUSES = [
  'completed',
  'paid',
  'signed',
  'in_progress',
  'accepted',
] as const

const ACCEPTANCE_THRESHOLD_HOURS = 6
const DOC_EXPIRY_WINDOW_DAYS = 30
const STALE_PUBLISHED_HOURS = 6
const STALE_PUBLISHED_ERROR_HOURS = 24
const STALE_REPORT_HOURS = 4
const STALE_REPORT_ERROR_HOURS = 12

export type AdminDashboardKpi = {
  jobsToday: number
  pendingAcceptance: number
  pendingOldestHours: number | null
  qualityQueue: number
  activeClients: number
  activeClerks: number
  revenueMonth: number
  clerkPayoutsPending: number
  /** Completed cleans sitting in `submitted`, waiting on admin sign-off
   *  before the cleaner is paid. */
  cleansAwaitingSignoff: number
  /** Sum of (total − paidTotal) across non-void, non-draft invoices.
   *  Provider-agnostic: the inbuilt + Xero providers both shadow into
   *  `invoices`, so this aggregate works for either active provider. */
  outstandingInvoices: number
  /** How many invoice rows that count rolls up — drives the card subtitle. */
  outstandingInvoiceCount: number
}

export type AdminDashboardChart = {
  jobsByDay: Array<{ date: string; count: number }>
  jobsByType: Array<{ name: string; value: number }>
  revenueByDay: Array<{ date: string; revenue: number }>
  topClients: Array<{ name: string; count: number }>
  topClientsByRevenue: Array<{ name: string; revenue: number }>
  topClerks: Array<{ name: string; count: number }>
  acceptanceRate: number
}

export type AdminDashboardAlert = {
  type: 'unaccepted' | 'document_expiry' | 'quality_review' | 'cleaning_signoff'
  message: string
  severity: 'warning' | 'error'
  /** Optional deep-link target (e.g. the job detail for a sign-off). */
  link?: string
}

export type AdminDashboardData = {
  kpi: AdminDashboardKpi
  chart: AdminDashboardChart
  alerts: AdminDashboardAlert[]
  generatedAt: string
}

/**
 * Public entry point. Cached at 60s — admin dashboards feel "live" at
 * that cadence and ~95% of admin navigations during a busy session land
 * inside the same window, dropping the per-page Postgres roundtrip
 * count by an order of magnitude. The cache key is global (no per-user
 * dimension) because every admin sees the same numbers; if we ever
 * scope dashboards per-region the key needs that dimension added.
 *
 * Cache invalidation is pure TTL — writes that would change a KPI
 * (job created, report submitted, payout settled) don't actively bust.
 * The 60s window is the SLA for staleness on dashboard reads. If a
 * specific KPI ever needs immediate write-through, switch that loader
 * out of the cache wrapper or `bust('admin:dashboard')` from the
 * relevant route handler.
 */
export async function loadAdminDashboard(): Promise<AdminDashboardData> {
  return getOrSet(cacheKey('admin', 'dashboard'), 60, loadAdminDashboardFresh)
}

async function loadAdminDashboardFresh(): Promise<AdminDashboardData> {
  const now = new Date()
  const todayIso = startOfDay(now).toISOString()
  const monthStartIso = startOfMonth(now).toISOString()
  const thirtyDaysAgoIso = subDays(now, 30).toISOString()
  const thirtyDaysAhead = addDays(now, DOC_EXPIRY_WINDOW_DAYS)
  const todayDateOnly = formatYmd(now)
  const thirtyDaysAheadDateOnly = formatYmd(thirtyDaysAhead)

  return db.transaction(async (tx) => {
    // --- KPIs ---------------------------------------------------------
    const [{ count: jobsToday }] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(jobs)
      .where(gte(jobs.createdAt, todayIso))

    const pendingRows = await tx
      .select({ id: jobs.id, createdAt: jobs.createdAt })
      .from(jobs)
      .where(eq(jobs.status, 'published'))
      .orderBy(asc(jobs.createdAt))

    const [{ count: qualityQueue }] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(reports)
      .where(eq(reports.status, 'submitted'))

    const [{ count: activeClients }] = await tx
      .select({
        count: sql<number>`count(distinct ${jobs.clientId})::int`,
      })
      .from(jobs)
      .where(gte(jobs.createdAt, monthStartIso))

    const [{ count: activeClerks }] = await tx
      .select({
        count: sql<number>`count(distinct ${jobs.clerkId})::int`,
      })
      .from(jobs)
      .where(
        and(
          gte(jobs.scheduledDate, thirtyDaysAgoIso.slice(0, 10)),
          isNotNull(jobs.clerkId),
          inArray(jobs.status, [...ACTIVE_CLERK_STATUSES])
        )
      )

    // Revenue: sum of final_price (fallback quoted_price) for completed/paid/signed
    // jobs updated this month. Use coalesce so a null final_price falls back to quoted.
    const [{ revenue: revenueMonth }] = await tx
      .select({
        revenue: sql<string>`coalesce(sum(coalesce(${jobs.finalPrice}, ${jobs.quotedPrice}, 0)), 0)`,
      })
      .from(jobs)
      .where(
        and(
          inArray(jobs.status, [...REVENUE_STATUSES]),
          gte(jobs.updatedAt, monthStartIso)
        )
      )

    // Clerk payouts pending: clerk_payment_date is null AND status in pending list.
    const [{ payouts: clerkPayoutsPending }] = await tx
      .select({
        payouts: sql<string>`coalesce(sum(coalesce(nullif(${jobs.clerkFinalPayout}, 0), ${jobs.clerkPayout}, 0)), 0)`,
      })
      .from(jobs)
      .where(
        and(
          inArray(jobs.status, [...PAYOUT_PENDING_STATUSES]),
          isNull(jobs.clerkPaymentDate)
        )
      )

    // Outstanding invoices: sum of (total − paid) across issued/sent/overdue
    // (regular invoices only — credit notes net out elsewhere). Provider-
    // agnostic since both backends shadow to the same `invoices` table.
    const [outstandingRow] = await tx
      .select({
        amount: sql<string>`coalesce(sum(${invoices.total} - ${invoices.paidTotal}), 0)`,
        count: sql<number>`count(*)::int`,
      })
      .from(invoices)
      .where(
        and(
          inArray(invoices.status, ['issued', 'sent', 'overdue']),
          eq(invoices.kind, 'invoice')
        )
      )

    // --- Charts -------------------------------------------------------
    // Pull one window of jobs to back the bar/pie/line charts.
    const recentJobs = await tx
      .select({
        id: jobs.id,
        createdAt: jobs.createdAt,
        updatedAt: jobs.updatedAt,
        inspectionType: jobs.inspectionType,
        status: jobs.status,
        finalPrice: jobs.finalPrice,
        quotedPrice: jobs.quotedPrice,
        clientId: jobs.clientId,
      })
      .from(jobs)
      .where(gte(jobs.createdAt, thirtyDaysAgoIso))
      .orderBy(asc(jobs.createdAt))

    const jobsByDay = bucketByDay(now, recentJobs.map((j) => j.createdAt))
    const jobsByType = countByKey(
      recentJobs.map(
        (j) =>
          INSPECTION_TYPE_LABELS[j.inspectionType as InspectionType] ??
          j.inspectionType
      )
    )

    const revenueRows = recentJobs.filter((j) =>
      (REVENUE_STATUSES as readonly string[]).includes(j.status)
    )
    const revenueByDay = sumByDay(
      now,
      revenueRows.map((j) => ({
        ts: j.updatedAt,
        amount: Number(j.finalPrice ?? j.quotedPrice ?? 0),
      }))
    )

    // Acceptance rate: fraction of last-30d non-draft jobs accepted within 6h.
    const acceptanceJobs = await tx
      .select({ createdAt: jobs.createdAt, acceptedAt: jobs.acceptedAt })
      .from(jobs)
      .where(
        and(gte(jobs.createdAt, thirtyDaysAgoIso), not(eq(jobs.status, 'draft')))
      )
    const acceptedWithin =
      acceptanceJobs.filter((j) => {
        if (!j.acceptedAt) return false
        return (
          hoursBetween(new Date(j.createdAt), new Date(j.acceptedAt)) <=
          ACCEPTANCE_THRESHOLD_HOURS
        )
      }).length
    const acceptanceRate =
      acceptanceJobs.length === 0
        ? 0
        : Math.round((acceptedWithin / acceptanceJobs.length) * 100)

    // Top 5 clients (by job count last 30d).
    const clientCounts = countByKey(recentJobs.map((j) => j.clientId)).slice(
      0,
      5
    )

    // Top 5 clients by revenue (all-time, revenue-status jobs). Distinct from
    // the by-volume chart: a client with a few high-value inspections can
    // outrank one with many cheap ones.
    const clientRevenueRows = await tx
      .select({
        clientId: jobs.clientId,
        revenue: sql<string>`coalesce(sum(coalesce(${jobs.finalPrice}, ${jobs.quotedPrice}, 0)), 0)`,
      })
      .from(jobs)
      .where(
        and(
          inArray(jobs.status, [...REVENUE_STATUSES]),
          isNotNull(jobs.clientId)
        )
      )
      .groupBy(jobs.clientId)
      .orderBy(
        desc(
          sql`coalesce(sum(coalesce(${jobs.finalPrice}, ${jobs.quotedPrice}, 0)), 0)`
        )
      )
      .limit(5)

    // One name lookup for the union of both client charts.
    const clientIds = Array.from(
      new Set<string>([
        ...clientCounts.map((r) => r.name),
        ...clientRevenueRows
          .map((r) => r.clientId)
          .filter((id): id is string => Boolean(id)),
      ])
    )
    const clientNameRows =
      clientIds.length === 0
        ? []
        : await tx
            .select({
              userId: profiles.userId,
              fullName: profiles.fullName,
              companyName: profiles.companyName,
            })
            .from(profiles)
            .where(inArray(profiles.userId, clientIds))
    const clientNameMap = new Map(
      clientNameRows.map((p) => [
        p.userId,
        p.companyName ?? p.fullName ?? 'Unknown',
      ])
    )
    const topClients = clientCounts.map((c) => ({
      name: clientNameMap.get(c.name) ?? 'Unknown',
      count: c.value,
    }))
    const topClientsByRevenue = clientRevenueRows
      .filter((r): r is typeof r & { clientId: string } => Boolean(r.clientId))
      .map((r) => ({
        name: clientNameMap.get(r.clientId) ?? 'Unknown',
        revenue: Number(r.revenue),
      }))

    // Top 5 clerks (completed/paid/signed jobs ever — separate query because
    // it spans the full history, not the 30d window).
    const clerkCompletedRows = await tx
      .select({
        clerkId: jobs.clerkId,
        count: sql<number>`count(*)::int`,
      })
      .from(jobs)
      .where(
        and(
          inArray(jobs.status, [...REVENUE_STATUSES]),
          isNotNull(jobs.clerkId)
        )
      )
      .groupBy(jobs.clerkId)
      .orderBy(desc(sql<number>`count(*)`))
      .limit(5)
    const topClerkIds = clerkCompletedRows
      .map((r) => r.clerkId)
      .filter((id): id is string => Boolean(id))
    const clerkNameRows =
      topClerkIds.length === 0
        ? []
        : await tx
            .select({
              userId: profiles.userId,
              fullName: profiles.fullName,
            })
            .from(profiles)
            .where(inArray(profiles.userId, topClerkIds))
    const clerkNameMap = new Map(
      clerkNameRows.map((p) => [p.userId, p.fullName ?? 'Unknown'])
    )
    const topClerks = clerkCompletedRows.map((r) => ({
      name: r.clerkId ? clerkNameMap.get(r.clerkId) ?? 'Unknown' : 'Unknown',
      count: Number(r.count),
    }))

    // Cleans awaiting admin sign-off (completed by the cleaner → `submitted`,
    // payout released only on approval). Pulled with address for the alerts.
    const cleanSignoffRows = await tx
      .select({
        id: jobs.id,
        deliveredAt: jobs.deliveredAt,
        addressLine1: properties.addressLine1,
        postcode: properties.postcode,
      })
      .from(jobs)
      .leftJoin(properties, eq(properties.id, jobs.propertyId))
      .where(
        and(
          eq(jobs.status, 'submitted'),
          sql`${jobs.inspectionType} LIKE 'clean\\_%'`
        )
      )
      .orderBy(asc(jobs.deliveredAt))
      .limit(20)
    const cleansAwaitingSignoff = cleanSignoffRows.length

    // --- Alerts -------------------------------------------------------
    const alerts: AdminDashboardAlert[] = []

    // 0. Cleans awaiting sign-off — link straight to each job's sign-off card.
    for (const c of cleanSignoffRows) {
      const addr =
        c.addressLine1 && c.postcode
          ? `${c.addressLine1}, ${c.postcode}`
          : 'a property'
      const hours = c.deliveredAt
        ? hoursBetween(new Date(c.deliveredAt), now)
        : null
      alerts.push({
        type: 'cleaning_signoff',
        message: `Clean ${c.id.slice(0, 8)} at ${addr} awaiting sign-off${
          hours !== null ? ` (${hours}h)` : ''
        }`,
        severity: hours !== null && hours > 24 ? 'error' : 'warning',
        link: `/admin/jobs/${c.id}`,
      })
    }

    // 1. Stale published jobs (>6h, error >24h).
    const stalePublished = await tx
      .select({
        id: jobs.id,
        createdAt: jobs.createdAt,
        addressLine1: properties.addressLine1,
        postcode: properties.postcode,
      })
      .from(jobs)
      .leftJoin(properties, eq(jobs.propertyId, properties.id))
      .where(eq(jobs.status, 'published'))
      .orderBy(asc(jobs.createdAt))
      .limit(20)
    for (const j of stalePublished) {
      const hours = hoursBetween(new Date(j.createdAt), now)
      if (hours <= STALE_PUBLISHED_HOURS) continue
      const addr =
        j.addressLine1 && j.postcode
          ? `${j.addressLine1}, ${j.postcode}`
          : 'Unknown'
      alerts.push({
        type: 'unaccepted',
        message: `${j.id.slice(0, 8)} at ${addr} : unaccepted for ${hours}h`,
        severity: hours > STALE_PUBLISHED_ERROR_HOURS ? 'error' : 'warning',
      })
    }

    // 2. Clerk doc expiries within 30 days. Listd-NEXT keeps these on
    //    profiles directly (no clerk_documents table).
    const expiringDocs = await tx
      .select({
        userId: profiles.userId,
        fullName: profiles.fullName,
        dbsExpiry: profiles.dbsExpiry,
        insuranceExpiry: profiles.insuranceExpiry,
        governmentIdExpiry: profiles.governmentIdExpiry,
      })
      .from(profiles)
      .where(
        sql`(
          (${profiles.dbsExpiry} >= ${todayDateOnly} and ${profiles.dbsExpiry} <= ${thirtyDaysAheadDateOnly})
          or (${profiles.insuranceExpiry} >= ${todayDateOnly} and ${profiles.insuranceExpiry} <= ${thirtyDaysAheadDateOnly})
          or (${profiles.governmentIdExpiry} >= ${todayDateOnly} and ${profiles.governmentIdExpiry} <= ${thirtyDaysAheadDateOnly})
        )`
      )
    for (const p of expiringDocs) {
      const fullName = p.fullName ?? 'Clerk'
      if (
        p.dbsExpiry &&
        p.dbsExpiry >= todayDateOnly &&
        p.dbsExpiry <= thirtyDaysAheadDateOnly
      ) {
        alerts.push({
          type: 'document_expiry',
          message: `${fullName} : DBS expires ${formatHumanDate(p.dbsExpiry)}`,
          severity: 'warning',
        })
      }
      if (
        p.insuranceExpiry &&
        p.insuranceExpiry >= todayDateOnly &&
        p.insuranceExpiry <= thirtyDaysAheadDateOnly
      ) {
        alerts.push({
          type: 'document_expiry',
          message: `${fullName} : Insurance expires ${formatHumanDate(p.insuranceExpiry)}`,
          severity: 'warning',
        })
      }
      if (
        p.governmentIdExpiry &&
        p.governmentIdExpiry >= todayDateOnly &&
        p.governmentIdExpiry <= thirtyDaysAheadDateOnly
      ) {
        alerts.push({
          type: 'document_expiry',
          message: `${fullName} : Government ID expires ${formatHumanDate(p.governmentIdExpiry)}`,
          severity: 'warning',
        })
      }
    }

    // 3. Reports stuck in quality review (>4h, error >12h).
    const staleReports = await tx
      .select({
        id: reports.id,
        jobId: reports.jobId,
        submittedAt: reports.submittedAt,
      })
      .from(reports)
      .where(eq(reports.status, 'submitted'))
      .limit(40)
    for (const r of staleReports) {
      if (!r.submittedAt) continue
      const hours = hoursBetween(new Date(r.submittedAt), now)
      if (hours <= STALE_REPORT_HOURS) continue
      alerts.push({
        type: 'quality_review',
        message: `Report for job ${r.jobId?.slice(0, 8) ?? '????????'}… in quality review for ${hours}h`,
        severity: hours > STALE_REPORT_ERROR_HOURS ? 'error' : 'warning',
      })
    }

    const oldestPending = pendingRows[0]?.createdAt ?? null
    const pendingOldestHours = oldestPending
      ? hoursBetween(new Date(oldestPending), now)
      : null

    return {
      kpi: {
        jobsToday: jobsToday ?? 0,
        pendingAcceptance: pendingRows.length,
        pendingOldestHours,
        qualityQueue: qualityQueue ?? 0,
        activeClients: activeClients ?? 0,
        activeClerks: activeClerks ?? 0,
        revenueMonth: Number(revenueMonth ?? 0),
        clerkPayoutsPending: Number(clerkPayoutsPending ?? 0),
        cleansAwaitingSignoff,
        outstandingInvoices: Number(outstandingRow?.amount ?? 0),
        outstandingInvoiceCount: outstandingRow?.count ?? 0,
      },
      chart: {
        jobsByDay,
        jobsByType,
        revenueByDay,
        topClients,
        topClientsByRevenue,
        topClerks,
        acceptanceRate,
      },
      alerts,
      generatedAt: now.toISOString(),
    }
  })
}

// ── helpers ──────────────────────────────────────────────────────────

function startOfDay(d: Date): Date {
  const out = new Date(d)
  out.setHours(0, 0, 0, 0)
  return out
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

function subDays(d: Date, n: number): Date {
  const out = new Date(d)
  out.setDate(out.getDate() - n)
  return out
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d)
  out.setDate(out.getDate() + n)
  return out
}

function formatYmd(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function formatHumanDate(ymd: string): string {
  const d = new Date(ymd)
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function hoursBetween(a: Date, b: Date): number {
  return Math.round(Math.abs(b.getTime() - a.getTime()) / (1000 * 60 * 60))
}

function bucketByDay(
  now: Date,
  isoTimestamps: string[]
): Array<{ date: string; count: number }> {
  const map = new Map<string, number>()
  for (let i = 29; i >= 0; i--) {
    map.set(formatBucketLabel(subDays(now, i)), 0)
  }
  for (const iso of isoTimestamps) {
    const key = formatBucketLabel(new Date(iso))
    if (map.has(key)) map.set(key, (map.get(key) ?? 0) + 1)
  }
  return Array.from(map.entries()).map(([date, count]) => ({ date, count }))
}

function sumByDay(
  now: Date,
  rows: Array<{ ts: string; amount: number }>
): Array<{ date: string; revenue: number }> {
  const map = new Map<string, number>()
  for (let i = 29; i >= 0; i--) {
    map.set(formatBucketLabel(subDays(now, i)), 0)
  }
  for (const r of rows) {
    const key = formatBucketLabel(new Date(r.ts))
    if (map.has(key)) map.set(key, (map.get(key) ?? 0) + r.amount)
  }
  return Array.from(map.entries()).map(([date, revenue]) => ({ date, revenue }))
}

function formatBucketLabel(d: Date): string {
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

function countByKey<T extends string | null | undefined>(
  values: T[]
): Array<{ name: string; value: number }> {
  const map = new Map<string, number>()
  for (const v of values) {
    if (!v) continue
    map.set(v, (map.get(v) ?? 0) + 1)
  }
  return Array.from(map.entries())
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
}
