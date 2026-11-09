import 'server-only'
import { and, asc, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm'
import { db, jobs, reports } from '@/db'
import { effectiveClerkPayout } from '@/lib/payout'
import { INSPECTION_TYPE_LABELS, type InspectionType } from '@/lib/pricing-matrix'

/**
 * Server-only data layer for the clerk dashboard. Mirrors the shape of
 * Lovable's `useClerkDashboard` hook output (consumed by `ClerkDashboardContent.tsx`).
 *
 * All values come from `jobs` + `reports` queries scoped to the clerk's
 * `clerk_id`. The stats are computed cheaply enough that we run them on
 * every dashboard render rather than caching.
 */

const COMPLETED_STATUSES = ['completed', 'paid'] as const
const PAYABLE_PENDING_STATUSES = [
  'completed',
  'signed',
  'reviewed',
  'submitted',
] as const

export type ClerkDashboardStats = {
  /** Published jobs not yet claimed by any clerk. The detail page filters
   *  further by coverage; this count is a coarse "is the queue empty" hint. */
  availableJobs: number
  /** Jobs scheduled for today AND assigned to this clerk. */
  todayInspections: number
  /** Reports this clerk has submitted that are still awaiting QA review. */
  submittedReports: number
  /** Jobs completed this calendar month. */
  monthJobs: number
  /** Earnings (clerk payout) credited this calendar month. */
  monthEarnings: number
  /** Completed/signed/etc. jobs with `clerk_payment_date IS NULL`. */
  pendingPayments: number
  /** All-time clerk earnings (completed + paid). */
  totalEarnings: number
  /** All-time completed-or-paid job count. */
  totalJobs: number
  /** All-time `totalEarnings / totalJobs` (rounded to int — display only). */
  avgJobValue: number
  /** Last 6 months: { month: 'Apr 26', jobs, earnings } oldest-first. */
  monthlyData: Array<{ month: string; jobs: number; earnings: number }>
  /** Pie-chart data: count of completed jobs grouped by inspection type. */
  inspectionTypeBreakdown: Array<{ type: string; count: number }>
}

export async function loadClerkDashboard(
  clerkId: string
): Promise<ClerkDashboardStats> {
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1)
  const todayYmd = formatYmd(now)

  return db.transaction(async (tx) => {
    // --- Parallelise the simple counts + sums ---------------------------
    const [
      availableRow,
      todayRow,
      submittedRow,
      monthRow,
      pendingRow,
      totalRow,
    ] = await Promise.all([
      tx
        .select({ count: sql<number>`count(*)::int` })
        .from(jobs)
        .where(and(eq(jobs.status, 'published'), isNull(jobs.clerkId))),

      tx
        .select({ count: sql<number>`count(*)::int` })
        .from(jobs)
        .where(
          and(
            eq(jobs.clerkId, clerkId),
            eq(jobs.scheduledDate, todayYmd)
          )
        ),

      tx
        .select({ count: sql<number>`count(*)::int` })
        .from(reports)
        .where(
          and(eq(reports.clerkId, clerkId), eq(reports.status, 'submitted'))
        ),

      // This-month aggregates: count + sum coalesced payout.
      tx
        .select({
          count: sql<number>`count(*)::int`,
          earnings: sql<string>`coalesce(sum(coalesce(nullif(${jobs.clerkFinalPayout}, 0), ${jobs.clerkPayout}, 0)), 0)`,
        })
        .from(jobs)
        .where(
          and(
            eq(jobs.clerkId, clerkId),
            inArray(jobs.status, [...COMPLETED_STATUSES]),
            gte(jobs.updatedAt, monthStart.toISOString())
          )
        ),

      tx
        .select({ count: sql<number>`count(*)::int` })
        .from(jobs)
        .where(
          and(
            eq(jobs.clerkId, clerkId),
            inArray(jobs.status, [...PAYABLE_PENDING_STATUSES]),
            isNull(jobs.clerkPaymentDate)
          )
        ),

      // All-time totals: count + sum.
      tx
        .select({
          count: sql<number>`count(*)::int`,
          earnings: sql<string>`coalesce(sum(coalesce(nullif(${jobs.clerkFinalPayout}, 0), ${jobs.clerkPayout}, 0)), 0)`,
        })
        .from(jobs)
        .where(
          and(
            eq(jobs.clerkId, clerkId),
            inArray(jobs.status, [...COMPLETED_STATUSES])
          )
        ),
    ])

    // --- Monthly buckets (last 6 months) -------------------------------
    // We pull every completed/paid job from the last 6 months and bucket in JS.
    // For higher volumes a `date_trunc` group-by would be faster, but at the
    // typical clerk's monthly volume this is fine.
    const recentJobs = await tx
      .select({
        updatedAt: jobs.updatedAt,
        clerkPayout: jobs.clerkPayout,
        clerkFinalPayout: jobs.clerkFinalPayout,
      })
      .from(jobs)
      .where(
        and(
          eq(jobs.clerkId, clerkId),
          inArray(jobs.status, [...COMPLETED_STATUSES]),
          gte(jobs.updatedAt, sixMonthsAgo.toISOString())
        )
      )
      .orderBy(asc(jobs.updatedAt))

    const monthlyData: Array<{ month: string; jobs: number; earnings: number }> = []
    const monthMap = new Map<string, { jobs: number; earnings: number }>()
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const key = monthKey(d)
      monthMap.set(key, { jobs: 0, earnings: 0 })
      monthlyData.push({ month: formatMonthLabel(d), jobs: 0, earnings: 0 })
    }
    for (const j of recentJobs) {
      const d = new Date(j.updatedAt)
      const key = monthKey(d)
      const bucket = monthMap.get(key)
      if (!bucket) continue
      bucket.jobs += 1
      bucket.earnings += effectiveClerkPayout(j.clerkFinalPayout, j.clerkPayout)
    }
    // Re-project ordered list with values from the map.
    for (let i = 0; i < 6; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1)
      const key = monthKey(d)
      const bucket = monthMap.get(key)
      monthlyData[i] = {
        month: formatMonthLabel(d),
        jobs: bucket?.jobs ?? 0,
        earnings: Math.round(bucket?.earnings ?? 0),
      }
    }

    // --- Inspection-type breakdown (all-time completed) -----------------
    const breakdownRows = await tx
      .select({
        inspectionType: jobs.inspectionType,
        count: sql<number>`count(*)::int`,
      })
      .from(jobs)
      .where(
        and(
          eq(jobs.clerkId, clerkId),
          inArray(jobs.status, [...COMPLETED_STATUSES])
        )
      )
      .groupBy(jobs.inspectionType)
      .orderBy(desc(sql<number>`count(*)`))

    const inspectionTypeBreakdown = breakdownRows.map((r) => ({
      type:
        INSPECTION_TYPE_LABELS[r.inspectionType as InspectionType] ??
        r.inspectionType,
      count: Number(r.count),
    }))

    const totalJobs = Number(totalRow[0]?.count ?? 0)
    const totalEarnings = Number(totalRow[0]?.earnings ?? 0)
    const monthEarnings = Number(monthRow[0]?.earnings ?? 0)

    return {
      availableJobs: Number(availableRow[0]?.count ?? 0),
      todayInspections: Number(todayRow[0]?.count ?? 0),
      submittedReports: Number(submittedRow[0]?.count ?? 0),
      monthJobs: Number(monthRow[0]?.count ?? 0),
      monthEarnings,
      pendingPayments: Number(pendingRow[0]?.count ?? 0),
      totalEarnings,
      totalJobs,
      avgJobValue:
        totalJobs === 0 ? 0 : Math.round(totalEarnings / totalJobs),
      monthlyData,
      inspectionTypeBreakdown,
    }
  })
}

// ── helpers ──────────────────────────────────────────────────────────

function formatYmd(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function formatMonthLabel(d: Date): string {
  return d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' })
}
