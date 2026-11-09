import 'server-only'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { db, jobs, properties } from '@/db'
import { effectiveClerkPayout } from '@/lib/payout'
import { type InspectionType } from '@/lib/pricing-matrix'

/**
 * Server-only data layer for the clerk Earnings page (Lovable port of
 * `ClerkEarnings.tsx`). One transaction returns:
 *
 *   - 4 summary stats (totalEarned, earnedThisMonth, pending, lastPayout)
 *   - paginated job history (20 rows per page) joined with property
 *
 * `pending` is the sum of payouts that have moved past `submitted` but
 * don't have a `clerk_payment_date` yet — money owed, not yet released.
 * `totalEarned` only counts jobs with a `clerk_payment_date` set (actual
 * payouts banked).
 */

const PAGE_SIZE = 20

// Statuses that contribute to the earnings pipeline. `submitted` /
// `reviewed` / `signed` aren't paid yet but they show in the history
// because the clerk wants to see them in the "pending" pipeline.
const EARNING_STATUSES = [
  'submitted',
  'reviewed',
  'signed',
  'completed',
  'paid',
] as const

export type ClerkEarningsRow = {
  id: string
  inspectionType: InspectionType
  scheduledDate: string
  status: string
  payout: string | null
  paymentDate: string | null
  payoutLocked: boolean
  property: {
    postcode: string | null
    city: string | null
  } | null
}

export type ClerkEarningsStats = {
  totalEarned: number
  earnedThisMonth: number
  pending: number
  lastPayoutAmount: number
  lastPayoutDate: string | null
}

export type ClerkEarningsData = {
  stats: ClerkEarningsStats
  rows: ClerkEarningsRow[]
  total: number
  page: number
  pageSize: number
}

export async function loadClerkEarnings(
  clerkId: string,
  page = 0
): Promise<ClerkEarningsData> {
  const offset = page * PAGE_SIZE

  return db.transaction(async (tx) => {
    // Pull every earning-eligible job for the stats computation.
    // For typical clerk volumes (hundreds, not thousands) this is a few KB —
    // the alternative of three aggregate queries would be slightly heavier
    // and the per-row payment-date check is awkward in pure SQL.
    const allRows = await tx
      .select({
        clerkPayout: jobs.clerkPayout,
        clerkFinalPayout: jobs.clerkFinalPayout,
        clerkPaymentDate: jobs.clerkPaymentDate,
      })
      .from(jobs)
      .where(
        and(
          eq(jobs.clerkId, clerkId),
          inArray(jobs.status, [...EARNING_STATUSES])
        )
      )

    const stats = computeStats(allRows)

    // Paginated history — joined with property for the address column.
    const historyRows = await tx
      .select({
        id: jobs.id,
        inspectionType: jobs.inspectionType,
        scheduledDate: jobs.scheduledDate,
        status: jobs.status,
        clerkPayout: jobs.clerkPayout,
        clerkFinalPayout: jobs.clerkFinalPayout,
        clerkPaymentDate: jobs.clerkPaymentDate,
        clerkPayoutLocked: jobs.clerkPayoutLocked,
        propPostcode: properties.postcode,
        propCity: properties.city,
      })
      .from(jobs)
      .leftJoin(properties, eq(properties.id, jobs.propertyId))
      .where(
        and(
          eq(jobs.clerkId, clerkId),
          inArray(jobs.status, [...EARNING_STATUSES])
        )
      )
      .orderBy(desc(jobs.scheduledDate))
      .limit(PAGE_SIZE)
      .offset(offset)

    return {
      stats,
      rows: historyRows.map((r) => ({
        id: r.id,
        inspectionType: r.inspectionType as InspectionType,
        scheduledDate: r.scheduledDate,
        status: r.status,
        payout: String(effectiveClerkPayout(r.clerkFinalPayout, r.clerkPayout)),
        paymentDate: r.clerkPaymentDate,
        payoutLocked: r.clerkPayoutLocked ?? false,
        property: r.propPostcode
          ? { postcode: r.propPostcode, city: r.propCity }
          : null,
      })),
      total: allRows.length,
      page,
      pageSize: PAGE_SIZE,
    }
  })
}

function computeStats(
  rows: Array<{
    clerkPayout: string | null
    clerkFinalPayout: string | null
    clerkPaymentDate: string | null
  }>
): ClerkEarningsStats {
  const monthStart = new Date(
    new Date().getFullYear(),
    new Date().getMonth(),
    1
  )
  let totalEarned = 0
  let earnedThisMonth = 0
  let pending = 0
  let lastPayoutAmount = 0
  let lastPayoutDate: string | null = null

  for (const r of rows) {
    const pay = effectiveClerkPayout(r.clerkFinalPayout, r.clerkPayout)
    if (r.clerkPaymentDate) {
      totalEarned += pay
      const payDate = new Date(r.clerkPaymentDate)
      if (payDate >= monthStart) earnedThisMonth += pay
      if (
        !lastPayoutDate ||
        payDate.getTime() > new Date(lastPayoutDate).getTime()
      ) {
        lastPayoutDate = r.clerkPaymentDate
        lastPayoutAmount = pay
      }
    } else {
      pending += pay
    }
  }

  return {
    totalEarned,
    earnedThisMonth,
    pending,
    lastPayoutAmount,
    lastPayoutDate,
  }
}

export function parseEarningsPage(
  sp: Record<string, string | string[] | undefined>
): number {
  const raw = sp.page
  const page = Array.isArray(raw) ? raw[0] : raw
  if (!page) return 0
  const n = Number.parseInt(page, 10)
  return Number.isFinite(n) && n >= 0 ? n : 0
}

export function getPaymentStatus(row: ClerkEarningsRow): 'paid' | 'pending' | 'processing' {
  if (row.paymentDate) return 'paid'
  if (
    row.status === 'completed' ||
    row.status === 'paid' ||
    row.status === 'signed'
  ) {
    return 'pending'
  }
  return 'processing'
}
