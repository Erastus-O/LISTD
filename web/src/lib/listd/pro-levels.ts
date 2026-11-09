import 'server-only'
import { and, eq, inArray, sql } from 'drizzle-orm'
import {
  withServiceRole,
  jobs,
  levelApplications,
  notifications,
  profiles,
  proRoleLevels,
  reviews,
  trainingCompletions,
  trainings,
  userRoles,
  type Tx,
} from '@/db'
import { logAuditEvent } from '@/lib/audit'
import { feeFromBase, type Pricing, type ProBase, type ProRole } from './pricing'
import { APP_ROLE_FOR, requiredLevelFor, roleForType } from './services'

/**
 * Pro roles and levels: three levels in each of Pro Clerk, Pro Cleaner and Pro
 * Trades, unlocked by completed jobs and ratings in that role, with a closer
 * LISTD review on a Pro's first jobs (the standards check).
 */

export const ROLE_LABEL: Record<ProRole, string> = {
  CLERK: 'Pro Clerk',
  CLEANER: 'Pro Cleaner',
  TRADES: 'Pro Trades',
}

export const LEVEL_RULES = [
  { minJobs: 0, minRating: 0 },
  { minJobs: 10, minRating: 4.5 },
  { minJobs: 30, minRating: 4.7 },
]

export const STANDARDS_JOBS = 5

const DONE = ['completed', 'paid'] as const

function jobRoleSql(role: ProRole) {
  if (role === 'CLEANER') return sql`${jobs.inspectionType} like 'clean\\_%'`
  if (role === 'TRADES') return sql`${jobs.inspectionType} = 'repairs'`
  return sql`${jobs.inspectionType} not like 'clean\\_%' and ${jobs.inspectionType} <> 'repairs'`
}

function workerColumn(role: ProRole) {
  return role === 'CLEANER' ? jobs.cleanerId : jobs.clerkId
}

export function badge(role: ProRole, level: number): string {
  return `${ROLE_LABEL[role]} · Level ${level}`
}

export async function getProLevel(tx: Tx, userId: string, role: ProRole): Promise<number> {
  const [row] = await tx
    .select({ level: proRoleLevels.level })
    .from(proRoleLevels)
    .where(and(eq(proRoleLevels.userId, userId), eq(proRoleLevels.role, role)))
    .limit(1)
  return row?.level ?? 1
}

/** Completed jobs and average rating, counted within the role. */
export async function roleStats(tx: Tx, userId: string, role: ProRole) {
  const [{ completed }] = await tx
    .select({ completed: sql<number>`count(*)::int` })
    .from(jobs)
    .where(and(eq(workerColumn(role), userId), inArray(jobs.status, [...DONE]), jobRoleSql(role)))
  const [{ rating, ratings }] = await tx
    .select({
      rating: sql<string | null>`avg(${reviews.rating})`,
      ratings: sql<number>`count(${reviews.rating})::int`,
    })
    .from(reviews)
    .innerJoin(jobs, eq(jobs.id, reviews.jobId))
    .where(and(eq(workerColumn(role), userId), jobRoleSql(role)))
  return { completed, rating: rating === null ? null : Number(rating), ratings }
}

/** First jobs in each role get a closer review, unless an admin passed it early. */
export async function standardsCheck(tx: Tx, userId: string, role: ProRole) {
  const [row] = await tx
    .select({ passedAt: proRoleLevels.standardsPassedAt })
    .from(proRoleLevels)
    .where(and(eq(proRoleLevels.userId, userId), eq(proRoleLevels.role, role)))
    .limit(1)
  const { completed } = await roleStats(tx, userId, role)
  const passed = Boolean(row?.passedAt) || completed >= STANDARDS_JOBS
  return {
    n: STANDARDS_JOBS,
    done: Math.min(completed, STANDARDS_JOBS),
    passed,
    label: passed ? 'Standards check passed' : `New to LISTD · job ${Math.min(STANDARDS_JOBS, completed + 1)} of ${STANDARDS_JOBS}`,
  }
}

/** Published trainings required for a role up to a level that the Pro hasn't done. */
export async function missingTrainings(tx: Tx, userId: string, role: ProRole, level: number) {
  const required = await tx
    .select({ id: trainings.id, title: trainings.title, level: trainings.level })
    .from(trainings)
    .where(and(eq(trainings.status, 'PUBLISHED'), eq(trainings.role, role), sql`${trainings.level} between 1 and ${level}`))
  if (!required.length) return []
  const done = await tx
    .select({ id: trainingCompletions.trainingId })
    .from(trainingCompletions)
    .where(and(eq(trainingCompletions.userId, userId), inArray(trainingCompletions.trainingId, required.map((t) => t.id))))
  const doneIds = new Set(done.map((d) => d.id))
  return required.filter((t) => !doneIds.has(t.id))
}

/** What stands between a Pro and a level. Empty means they can apply. */
export async function levelRequirements(tx: Tx, userId: string, role: ProRole, toLevel: number) {
  const current = await getProLevel(tx, userId, role)
  const stats = await roleStats(tx, userId, role)
  const rule = LEVEL_RULES[toLevel - 1]
  const blockers: string[] = []
  if (toLevel !== current + 1) blockers.push(`You can only apply for Level ${current + 1} next.`)
  if (stats.completed < rule.minJobs) blockers.push(`Needs ${rule.minJobs} completed jobs in this role. You have ${stats.completed}.`)
  if ((stats.rating ?? 0) < rule.minRating) blockers.push(`Needs a ${rule.minRating} rating or higher.`)
  if (toLevel >= 2 && !(await standardsCheck(tx, userId, role)).passed) blockers.push('Pass the standards check first.')
  const missing = await missingTrainings(tx, userId, role, toLevel)
  if (missing.length) blockers.push(`Complete first: ${missing.map((t) => t.title).join(', ')}.`)
  return { current, stats, blockers }
}

export async function applyForLevel(tx: Tx, userId: string, role: ProRole, toLevel: number, note?: string) {
  const { current, stats, blockers } = await levelRequirements(tx, userId, role, toLevel)
  if (blockers.length) return { ok: false as const, blockers }
  const [open] = await tx
    .select({ id: levelApplications.id })
    .from(levelApplications)
    .where(and(eq(levelApplications.userId, userId), eq(levelApplications.role, role), eq(levelApplications.status, 'PENDING')))
    .limit(1)
  if (open) return { ok: false as const, blockers: ['You already have an application waiting for review.'] }
  const [row] = await tx
    .insert(levelApplications)
    .values({ userId, role, fromLevel: current, toLevel, note: note ?? null, snapshot: stats })
    .returning({ id: levelApplications.id })
  return { ok: true as const, id: row.id }
}

/** Set a level (admin decision). Required training has no override. */
export async function setProLevel(tx: Tx, p: { userId: string; role: ProRole; level: number; actorId: string; reason: string }) {
  const missing = await missingTrainings(tx, p.userId, p.role, p.level)
  if (missing.length) {
    return { ok: false as const, error: `Complete first: ${missing.map((t) => t.title).join(', ')}.` }
  }
  const before = await getProLevel(tx, p.userId, p.role)
  await tx
    .insert(proRoleLevels)
    .values({ userId: p.userId, role: p.role, level: p.level })
    .onConflictDoUpdate({
      target: [proRoleLevels.userId, proRoleLevels.role],
      set: { level: p.level, updatedAt: sql`now()` },
    })
  await logAuditEvent(tx, {
    category: 'verification',
    action: 'pro.level_changed',
    actorUserId: p.actorId,
    targetType: 'profile',
    targetId: p.userId,
    payload: { role: p.role, before, after: p.level, reason: p.reason },
  })
  await tx.insert(notifications).values({
    userId: p.userId,
    type: 'system',
    title: p.level > before ? `Now ${badge(p.role, p.level)}` : `Level updated to ${badge(p.role, p.level)}`,
    message: p.reason,
    link: '/clerk/settings',
  })
  return { ok: true as const, before }
}

export async function decideLevelApplication(
  tx: Tx,
  p: { id: string; actorId: string; approve: boolean; reason: string }
) {
  const [app] = await tx.select().from(levelApplications).where(eq(levelApplications.id, p.id)).limit(1)
  if (!app) return { ok: false as const, error: 'Application not found.' }
  if (app.status !== 'PENDING') return { ok: false as const, error: 'This application has already been decided.' }
  const role = app.role as ProRole
  if (p.approve) {
    const set = await setProLevel(tx, { userId: app.userId, role, level: app.toLevel, actorId: p.actorId, reason: p.reason })
    if (!set.ok) return set
  }
  await tx
    .update(levelApplications)
    .set({
      status: p.approve ? 'APPROVED' : 'REJECTED',
      decidedBy: p.actorId,
      decisionReason: p.reason,
      decidedAt: sql`now()`,
    })
    .where(eq(levelApplications.id, p.id))
  if (!p.approve) {
    await tx.insert(notifications).values({
      userId: app.userId,
      type: 'system',
      title: `${badge(role, app.toLevel)} application declined`,
      message: p.reason,
      link: '/clerk/settings',
    })
  }
  return { ok: true as const }
}

/**
 * Can this Pro take this job? Checked when a job is offered and accepted.
 * Null means yes; otherwise the reason to show.
 */
/** Vetting: only a Pro LISTD has verified can take a job. Checked on accept, not just on the page. */
export async function proVerificationBlock(tx: Tx, userId: string): Promise<string | null> {
  const [me] = await tx
    .select({ status: profiles.verificationStatus })
    .from(profiles)
    .where(eq(profiles.userId, userId))
    .limit(1)
  return me?.status === 'verified' ? null : 'Your account needs verifying before you can accept jobs.'
}

export async function proJobBlock(
  tx: Tx,
  userId: string,
  job: { inspectionType: string; requiredLevel: number | null; bedrooms: number | null }
): Promise<string | null> {
  const role = roleForType(job.inspectionType)
  const held = await tx
    .select({ role: userRoles.role })
    .from(userRoles)
    .where(and(eq(userRoles.userId, userId), eq(userRoles.role, APP_ROLE_FOR[role])))
    .limit(1)
  if (!held.length) return `This job needs the ${ROLE_LABEL[role]} role.`
  const need = job.requiredLevel ?? requiredLevelFor(job.inspectionType, job.bedrooms ?? 0)
  const have = await getProLevel(tx, userId, role)
  return have < need ? `This job needs ${badge(role, need)}. You’re Level ${have}.` : null
}

/**
 * Fee for the Pro who accepted: workload at THEIR level. Keeps the held payment
 * in step, so the later transfer pays the right amount. Jobs from before this
 * change have no pro_base and keep the payout stored on them.
 */
export async function setFeeForAcceptingPro(tx: Tx, pr: Pricing, jobId: string, userId: string) {
  const [job] = await tx
    .select({ inspectionType: jobs.inspectionType, proBase: jobs.proBase })
    .from(jobs)
    .where(eq(jobs.id, jobId))
    .limit(1)
  if (!job?.proBase) return null
  const role = roleForType(job.inspectionType)
  const level = await getProLevel(tx, userId, role)
  const feeP = feeFromBase(pr, job.proBase as ProBase, level)
  const pounds = (feeP / 100).toString()
  await tx
    .update(jobs)
    .set(role === 'CLEANER' ? { cleanerPayout: pounds, updatedAt: sql`now()` } : { clerkPayout: pounds, clerkLevelAtJob: level, updatedAt: sql`now()` })
    .where(eq(jobs.id, jobId))
  await tx.execute(sql`
    update escrow_transactions
       set clerk_amount = ${feeP},
           platform_fee = greatest(0, gross_amount - ${feeP}),
           updated_at = now()
     where job_id = ${jobId} and status in ('pending', 'held')
  `)
  return { feeP, level }
}

/** A Pro's roles and levels, loaded once for filtering a job feed. */
export async function proEligibility(tx: Tx, userId: string) {
  const roles = await tx.select({ role: userRoles.role }).from(userRoles).where(eq(userRoles.userId, userId))
  const levels = await tx
    .select({ role: proRoleLevels.role, level: proRoleLevels.level })
    .from(proRoleLevels)
    .where(eq(proRoleLevels.userId, userId))
  const roleSet = new Set<string>(roles.map((r) => r.role))
  const levelBy = new Map(levels.map((l) => [l.role, l.level]))
  return (job: { inspectionType: string; requiredLevel: number | null; bedrooms: number | null }) => {
    const role = roleForType(job.inspectionType)
    if (!roleSet.has(APP_ROLE_FOR[role])) return false
    const need = job.requiredLevel ?? requiredLevelFor(job.inspectionType, job.bedrooms ?? 0)
    return (levelBy.get(role) ?? 1) >= need
  }
}

/** Everything the Pro and admin screens show per role the Pro holds. */
export async function proRoleSummaries(tx: Tx, userId: string) {
  const held = await tx.select({ role: userRoles.role }).from(userRoles).where(eq(userRoles.userId, userId))
  const roles = (Object.keys(APP_ROLE_FOR) as ProRole[]).filter((r) => held.some((h) => h.role === APP_ROLE_FOR[r]))
  const out = []
  for (const role of roles) {
    const level = await getProLevel(tx, userId, role)
    const check = await standardsCheck(tx, userId, role)
    const stats = await roleStats(tx, userId, role)
    const next = level < 3 ? await levelRequirements(tx, userId, role, level + 1) : null
    const [pending] = await tx
      .select({ toLevel: levelApplications.toLevel })
      .from(levelApplications)
      .where(and(eq(levelApplications.userId, userId), eq(levelApplications.role, role), eq(levelApplications.status, 'PENDING')))
      .limit(1)
    out.push({
      role,
      label: ROLE_LABEL[role],
      level,
      standardsLabel: check.label,
      standardsPassed: check.passed,
      completed: stats.completed,
      rating: stats.rating,
      blockers: next?.blockers ?? [],
      pendingToLevel: pending?.toLevel ?? null,
    })
  }
  return out
}

export async function loadAdminProLevels(userId: string) {
  return withServiceRole(async (tx) => {
    const roles = await proRoleSummaries(tx, userId)
    const apps = await tx
      .select({ id: levelApplications.id, role: levelApplications.role, toLevel: levelApplications.toLevel, note: levelApplications.note })
      .from(levelApplications)
      .where(and(eq(levelApplications.userId, userId), eq(levelApplications.status, 'PENDING')))
    return {
      userId,
      roles,
      applications: apps.map((a) => ({ ...a, role: a.role as ProRole, label: ROLE_LABEL[a.role as ProRole] })),
    }
  })
}
