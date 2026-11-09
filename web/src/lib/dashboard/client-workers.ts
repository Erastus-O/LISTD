import 'server-only'
import { and, asc, count, desc, eq, inArray, ne, sql } from 'drizzle-orm'
import {
  db,
  jobs,
  organisationMembers,
  profiles,
} from '@/db'
import { getSupabaseAdmin } from '@/lib/supabase/admin'

/**
 * Server-only data layer for the client Team tab + worker surfaces.
 *
 * Resolves the caller's organisation membership + sibling workers, and
 * provides "by-worker" aggregations the owner dashboard surfaces.
 */

export type CallerMembership = {
  organisationId: string
  orgRole: string
  status: string
}

/**
 * Caller's active organisation membership (if any). Used to gate worker
 * routes (owner-only operations) and to scope worker queries to the
 * caller's org.
 */
export async function loadCallerMembership(
  userId: string
): Promise<CallerMembership | null> {
  const [row] = await db
    .select({
      organisationId: organisationMembers.organisationId,
      orgRole: organisationMembers.orgRole,
      status: organisationMembers.status,
    })
    .from(organisationMembers)
    .where(
      and(
        eq(organisationMembers.userId, userId),
        eq(organisationMembers.status, 'active')
      )
    )
    .limit(1)
  return row ?? null
}

export type WorkerRow = {
  userId: string
  fullName: string | null
  avatarUrl: string | null
  email: string | null
  status: string
  invitedAt: string | null
  lastActiveAt: string | null
  jobsPosted: number
}

/**
 * List the workers in `organisationId` (excluding the owner themselves).
 * Joined with `profiles` for display + a count of jobs each worker has
 * posted (`jobs.created_by_user_id`).
 *
 * Emails come from Supabase auth — one admin call per page render, batched
 * across workers. Failures degrade to `null` rather than 500ing.
 */
export async function loadOrgWorkers(
  organisationId: string,
  ownerUserId: string
): Promise<WorkerRow[]> {
  const memberRows = await db
    .select({
      userId: organisationMembers.userId,
      orgRole: organisationMembers.orgRole,
      status: organisationMembers.status,
      invitedAt: organisationMembers.invitedAt,
      lastActiveAt: organisationMembers.lastActiveAt,
      fullName: profiles.fullName,
      avatarUrl: profiles.avatarUrl,
    })
    .from(organisationMembers)
    .leftJoin(profiles, eq(profiles.userId, organisationMembers.userId))
    .where(
      and(
        eq(organisationMembers.organisationId, organisationId),
        ne(organisationMembers.userId, ownerUserId)
      )
    )
    .orderBy(asc(profiles.fullName))

  if (memberRows.length === 0) return []

  const workerIds = memberRows.map((m) => m.userId)
  const jobCountRows = await db
    .select({
      userId: jobs.createdByUserId,
      jobsPosted: count(),
    })
    .from(jobs)
    .where(inArray(jobs.createdByUserId, workerIds))
    .groupBy(jobs.createdByUserId)
  const jobCountMap = new Map(
    jobCountRows
      .filter((r): r is { userId: string; jobsPosted: number } =>
        Boolean(r.userId)
      )
      .map((r) => [r.userId, r.jobsPosted])
  )

  // Fetch emails in parallel; tolerate per-user failures.
  const supabaseAdmin = getSupabaseAdmin()
  const emailEntries = await Promise.all(
    workerIds.map(async (uid) => {
      try {
        const res = await supabaseAdmin.auth.admin.getUserById(uid)
        return [uid, res.data?.user?.email ?? null] as const
      } catch {
        return [uid, null] as const
      }
    })
  )
  const emailMap = new Map(emailEntries)

  return memberRows.map((m) => ({
    userId: m.userId,
    fullName: m.fullName,
    avatarUrl: m.avatarUrl,
    email: emailMap.get(m.userId) ?? null,
    status: m.status,
    invitedAt: m.invitedAt,
    lastActiveAt: m.lastActiveAt,
    jobsPosted: jobCountMap.get(m.userId) ?? 0,
  }))
}

export type WorkerVolumePoint = {
  userId: string
  fullName: string | null
  jobsPosted: number
}

/**
 * Jobs-posted-per-worker in the last `days` window. Used by the client
 * dashboard's worker-volume chart. Limits to top 10 by volume to keep the
 * bar chart legible.
 */
export async function loadWorkerVolume(
  organisationId: string,
  days = 30
): Promise<WorkerVolumePoint[]> {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  const rows = await db
    .select({
      userId: jobs.createdByUserId,
      jobsPosted: count(),
      fullName: profiles.fullName,
    })
    .from(jobs)
    .leftJoin(profiles, eq(profiles.userId, jobs.createdByUserId))
    .where(
      and(
        eq(jobs.organisationId, organisationId),
        sql`${jobs.createdAt} >= ${cutoff.toISOString()}`
      )
    )
    .groupBy(jobs.createdByUserId, profiles.fullName)
    .orderBy(desc(count()))
    .limit(10)
  return rows
    .filter((r): r is { userId: string; jobsPosted: number; fullName: string | null } =>
      Boolean(r.userId)
    )
    .map((r) => ({
      userId: r.userId,
      fullName: r.fullName,
      jobsPosted: r.jobsPosted,
    }))
}

const COMPLETED_STATUSES = ['completed', 'paid', 'signed'] as const

export type WorkerLeaderboardRow = {
  userId: string
  fullName: string | null
  avatarUrl: string | null
  jobsPosted: number
  spend: number
  completionRatePercent: number | null
}

/**
 * Top-N workers by jobs posted in the last `days` window, joined with
 * their spend (sum of `final_price ?? quoted_price`) and a
 * completion-rate percentage (jobs in completed/paid/signed status
 * divided by total posted). Used by the WorkerLeaderboardCard on
 * /client/dashboard.
 */
export async function loadWorkerLeaderboard(
  organisationId: string,
  options: { days?: number; limit?: number } = {}
): Promise<WorkerLeaderboardRow[]> {
  const { days = 90, limit = 10 } = options
  const sinceIso = new Date(
    Date.now() - days * 24 * 60 * 60 * 1000
  ).toISOString()

  const completedExpr = sql<number>`sum(case when ${jobs.status} = ANY(${sql.raw(
    `ARRAY[${COMPLETED_STATUSES.map((s) => `'${s}'`).join(',')}]::job_status[]`
  )}) then 1 else 0 end)::int`
  const spendExpr = sql<string>`coalesce(sum(coalesce(${jobs.finalPrice}, ${jobs.quotedPrice})), 0)`

  const rows = await db
    .select({
      userId: jobs.createdByUserId,
      fullName: profiles.fullName,
      avatarUrl: profiles.avatarUrl,
      jobsPosted: count(),
      spend: spendExpr,
      completed: completedExpr,
    })
    .from(jobs)
    .leftJoin(profiles, eq(profiles.userId, jobs.createdByUserId))
    .where(
      and(
        eq(jobs.organisationId, organisationId),
        sql`${jobs.createdAt} >= ${sinceIso}`
      )
    )
    .groupBy(jobs.createdByUserId, profiles.fullName, profiles.avatarUrl)
    .orderBy(desc(count()))
    .limit(limit)

  return rows
    .filter((r): r is typeof r & { userId: string } => Boolean(r.userId))
    .map((r) => ({
      userId: r.userId,
      fullName: r.fullName,
      avatarUrl: r.avatarUrl,
      jobsPosted: r.jobsPosted,
      spend: Number(r.spend),
      completionRatePercent:
        r.jobsPosted === 0
          ? null
          : Math.round((Number(r.completed) / r.jobsPosted) * 100),
    }))
}
