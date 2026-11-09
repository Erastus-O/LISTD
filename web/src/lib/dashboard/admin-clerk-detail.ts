import 'server-only'
import { and, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm'
import {
  clerkIncidents,
  db,
  jobs,
  profiles,
  properties,
  reviews,
  strikes,
} from '@/db'
import { effectiveClerkPayout } from '@/lib/payout'

/**
 * Server-only data layer for the admin Clerk Detail page (Lovable layout
 * port). Mirrors the panels Lovable's AdminClerkDetail surfaces:
 *
 *   - Earnings History (stats + recent jobs)
 *   - Quality Reviews (avg rating, count, recent text)
 *   - Incidents & Strikes (combined list, newest first)
 *   - Badge Control criteria (level-up checklist with real evaluations)
 *
 * Account Details + Verification Documents already render from the existing
 * `loadAdminClerkProfile`-style read in [page.tsx](../../app/admin/clerks/[clerkId]/page.tsx);
 * this module supplies the rest.
 */

const REVENUE_STATUSES = ['completed', 'paid'] as const
const ACCEPTED_STATUSES = [
  'accepted',
  'assigned',
  'in_progress',
  'submitted',
  'reviewed',
  'signed',
  'completed',
  'paid',
] as const

const LEVEL_UP_JOBS_THRESHOLD = 20
const LEVEL_UP_RATING_THRESHOLD = 4.5

export type ClerkEarningsRow = {
  id: string
  scheduledDate: string
  inspectionType: string
  status: string
  payout: string | null
  propertyAddress: string | null
  propertyPostcode: string | null
}

export type ClerkEarningsStats = {
  totalEarned: number
  jobsCompleted: number
  acceptanceRatePercent: number | null
}

export type ClerkReviewRow = {
  id: string
  rating: number
  reviewText: string | null
  clerkResponse: string | null
  createdAt: string
}

export type ClerkReviewSummary = {
  averageRating: number | null
  count: number
  recent: ClerkReviewRow[]
}

export type ClerkIncidentRow = {
  id: string
  kind: 'incident' | 'strike'
  severity: string
  notes: string | null
  active: boolean
  createdAt: string
}

export type ClerkBadgeCriteria = {
  currentLevel: number
  nextLevel: number
  criteria: Array<{ key: string; label: string; met: boolean }>
  /** All real-data criteria met (academy module is excluded — schema-less). */
  allRealCriteriaMet: boolean
}

export type ClerkDetailPanels = {
  earningsStats: ClerkEarningsStats
  earningsHistory: ClerkEarningsRow[]
  reviewSummary: ClerkReviewSummary
  incidents: ClerkIncidentRow[]
  badge: ClerkBadgeCriteria
}

const HISTORY_LIMIT = 50
const RECENT_REVIEWS_LIMIT = 10
const INCIDENTS_LIMIT = 30

export async function loadAdminClerkPanels(
  clerkId: string
): Promise<ClerkDetailPanels> {
  return db.transaction(async (tx) => {
    // Earnings history — every job ever assigned to this clerk, with
    // payout coalesced from clerk_final_payout → clerk_payout.
    const historyRows = await tx
      .select({
        id: jobs.id,
        scheduledDate: jobs.scheduledDate,
        inspectionType: jobs.inspectionType,
        status: jobs.status,
        clerkPayout: jobs.clerkPayout,
        clerkFinalPayout: jobs.clerkFinalPayout,
        addressLine1: properties.addressLine1,
        postcode: properties.postcode,
      })
      .from(jobs)
      .leftJoin(properties, eq(properties.id, jobs.propertyId))
      .where(eq(jobs.clerkId, clerkId))
      .orderBy(desc(jobs.scheduledDate))
      .limit(HISTORY_LIMIT)

    const earningsHistory: ClerkEarningsRow[] = historyRows.map((r) => ({
      id: r.id,
      scheduledDate: r.scheduledDate,
      inspectionType: r.inspectionType,
      status: r.status,
      payout: String(effectiveClerkPayout(r.clerkFinalPayout, r.clerkPayout)),
      propertyAddress: r.addressLine1,
      propertyPostcode: r.postcode,
    }))

    // Aggregate stats — total earned + jobs completed + acceptance rate.
    // Acceptance rate = accepted-or-later / total assigned (Lovable computes
    // it the same way; not a strict 6-hour SLA).
    const [{ totalEarned }] = await tx
      .select({
        totalEarned: sql<string>`coalesce(sum(coalesce(nullif(${jobs.clerkFinalPayout}, 0), ${jobs.clerkPayout}, 0)), 0)`,
      })
      .from(jobs)
      .where(
        and(
          eq(jobs.clerkId, clerkId),
          inArray(jobs.status, [...REVENUE_STATUSES])
        )
      )
    const [{ jobsCompleted }] = await tx
      .select({
        jobsCompleted: sql<number>`count(*)::int`,
      })
      .from(jobs)
      .where(
        and(
          eq(jobs.clerkId, clerkId),
          inArray(jobs.status, [...REVENUE_STATUSES])
        )
      )
    // Two queries instead of one with a FILTER clause: `jobs.status` is
    // a `job_status` pgEnum, and Postgres rejects `enum = any(text[])`
    // without an explicit cast on every value. Drizzle's `inArray`
    // handles the cast automatically so two simple counts are clearer
    // than wrestling with `sql.raw` + `::text[]`.
    const [{ assignedTotal }] = await tx
      .select({
        assignedTotal: sql<number>`count(*)::int`,
      })
      .from(jobs)
      .where(eq(jobs.clerkId, clerkId))

    const [{ acceptedCount }] = await tx
      .select({
        acceptedCount: sql<number>`count(*)::int`,
      })
      .from(jobs)
      .where(
        and(
          eq(jobs.clerkId, clerkId),
          inArray(jobs.status, [...ACCEPTED_STATUSES])
        )
      )

    const earningsStats: ClerkEarningsStats = {
      totalEarned: Number(totalEarned ?? 0),
      jobsCompleted: Number(jobsCompleted ?? 0),
      acceptanceRatePercent:
        assignedTotal === 0
          ? null
          : Math.round((Number(acceptedCount) / Number(assignedTotal)) * 100),
    }

    // Reviews — average rating + count + recent textual reviews.
    const [{ avgRating, reviewCount }] = await tx
      .select({
        avgRating: sql<string | null>`avg(${reviews.rating})::numeric(3,2)`,
        reviewCount: sql<number>`count(*)::int`,
      })
      .from(reviews)
      .where(eq(reviews.revieweeId, clerkId))

    const recentReviews = await tx
      .select({
        id: reviews.id,
        rating: reviews.rating,
        reviewText: reviews.reviewText,
        clerkResponse: reviews.clerkResponse,
        createdAt: reviews.createdAt,
      })
      .from(reviews)
      .where(
        and(eq(reviews.revieweeId, clerkId), isNotNull(reviews.reviewText))
      )
      .orderBy(desc(reviews.createdAt))
      .limit(RECENT_REVIEWS_LIMIT)

    const reviewSummary: ClerkReviewSummary = {
      averageRating: avgRating === null ? null : Number(avgRating),
      count: Number(reviewCount ?? 0),
      recent: recentReviews,
    }

    // Incidents + strikes — combined feed, newest first.
    const incidentRows = await tx
      .select({
        id: clerkIncidents.id,
        severity: clerkIncidents.severity,
        notes: clerkIncidents.notes,
        createdAt: clerkIncidents.createdAt,
      })
      .from(clerkIncidents)
      .where(eq(clerkIncidents.clerkId, clerkId))
      .orderBy(desc(clerkIncidents.createdAt))
      .limit(INCIDENTS_LIMIT)
    const strikeRows = await tx
      .select({
        id: strikes.id,
        severity: strikes.severity,
        reason: strikes.reason,
        active: strikes.active,
        createdAt: strikes.createdAt,
      })
      .from(strikes)
      .where(eq(strikes.clerkId, clerkId))
      .orderBy(desc(strikes.createdAt))
      .limit(INCIDENTS_LIMIT)

    const incidents: ClerkIncidentRow[] = [
      ...incidentRows.map((i) => ({
        id: i.id,
        kind: 'incident' as const,
        severity: i.severity,
        notes: i.notes,
        active: true,
        createdAt: i.createdAt,
      })),
      ...strikeRows.map((s) => ({
        id: s.id,
        kind: 'strike' as const,
        severity: `Severity ${s.severity}`,
        notes: s.reason,
        active: s.active,
        createdAt: s.createdAt,
      })),
    ].sort((a, b) => b.createdAt.localeCompare(a.createdAt))

    // Badge Control — current level + criteria for next level. Real
    // evaluations where the schema supports it; the academy criterion is
    // a deliberate placeholder until that surface exists.
    const [profile] = await tx
      .select({
        verificationStatus: profiles.verificationStatus,
        clerkLevel: profiles.clerkLevel,
        clerkJobsCompleted: profiles.clerkJobsCompleted,
      })
      .from(profiles)
      .where(eq(profiles.userId, clerkId))
      .limit(1)
    const currentLevel = profile?.clerkLevel ?? 1
    const isVerified = profile?.verificationStatus === 'verified'
    const totalJobs = Number(profile?.clerkJobsCompleted ?? 0)
    const avgRatingNum =
      reviewSummary.averageRating === null ? 0 : reviewSummary.averageRating
    const realCriteria = [
      {
        key: 'verified',
        label: 'Level 1 Verified',
        met: isVerified,
      },
      {
        key: 'jobs',
        label: `${LEVEL_UP_JOBS_THRESHOLD}+ Completed Jobs`,
        met: totalJobs >= LEVEL_UP_JOBS_THRESHOLD,
      },
      {
        key: 'rating',
        label: `Avg Rating ≥ ${LEVEL_UP_RATING_THRESHOLD}`,
        met: avgRatingNum >= LEVEL_UP_RATING_THRESHOLD,
      },
    ]
    const criteria = [
      ...realCriteria,
      {
        key: 'academy',
        label: 'Academy Module Complete',
        met: false,
      },
    ]
    const allRealCriteriaMet = realCriteria.every((c) => c.met)

    return {
      earningsStats,
      earningsHistory,
      reviewSummary,
      incidents,
      badge: {
        currentLevel,
        nextLevel: currentLevel + 1,
        criteria,
        allRealCriteriaMet,
      },
    }
  })
}
