import 'server-only'
import { and, eq, inArray, isNotNull, isNull, lte, notExists, sql } from 'drizzle-orm'
import {
  disputes,
  escrowTransactions,
  jobs,
  notifications,
  payoutRuns,
  profiles,
  properties,
  withServiceRole,
  type Tx,
} from '@/db'
import { logAuditEvent } from '@/lib/audit'
import { releaseEscrowForJob } from '@/lib/billing/escrow'
import { roleForType } from './services'

/**
 * Client approval lifecycle (client decision: follow the new interface).
 *
 *   submitted  LISTD reviews the work
 *      |  releaseToClient()           starts the review window (48h by default)
 *   reviewed   "Ready to approve"
 *      |  approveJob('client')        or 'auto' when the window closes, 'admin' by LISTD
 *   completed  "Approved"; payout becomes eligible
 *      |  runWeeklyPayouts()          pays once a week
 *
 * A correction request sends the job back to the Pro. An open dispute pauses the
 * window and freezes the payout. Auto-approval is recorded as AUTO and is never
 * treated as the client's consent.
 */

export type ApprovalMode = 'client' | 'auto' | 'admin'

const OPEN_DISPUTE = ['open', 'under_review', 'escalated']

async function hasOpenDispute(tx: Tx, jobId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: disputes.id })
    .from(disputes)
    .where(and(eq(disputes.jobId, jobId), inArray(disputes.status, OPEN_DISPUTE)))
    .limit(1)
  return Boolean(row)
}

const ref = (jobId: string) => jobId.slice(0, 8)

async function addressOf(tx: Tx, propertyId: string): Promise<string> {
  const [p] = await tx
    .select({ line1: properties.addressLine1, postcode: properties.postcode })
    .from(properties)
    .where(eq(properties.id, propertyId))
    .limit(1)
  return p?.line1 ? `${p.line1}${p.postcode ? `, ${p.postcode}` : ''}` : 'your property'
}

/** LISTD has reviewed the work: open the client's approval window. */
export async function releaseToClient(
  tx: Tx,
  p: { jobId: string; actorId: string | null; reviewHours: number; reportUrl?: string | null; via: string; notes?: string | null }
) {
  const dueAt = new Date(Date.now() + p.reviewHours * 3600_000).toISOString()
  const claimed = await tx
    .update(jobs)
    .set({
      status: 'reviewed',
      deliveredAt: sql`now()`,
      clientReviewDueAt: dueAt,
      ...(p.reportUrl ? { reportUrl: p.reportUrl } : {}),
      updatedAt: sql`now()`,
    })
    .where(and(eq(jobs.id, p.jobId), eq(jobs.status, 'submitted')))
    .returning({ clientId: jobs.clientId, propertyId: jobs.propertyId })
  if (!claimed.length) return { ok: false as const, error: 'This job isn’t waiting for LISTD review.' }
  const job = claimed[0]
  await logAuditEvent(tx, {
    category: 'job_lifecycle',
    action: 'job.released_to_client',
    actorUserId: p.actorId,
    targetType: 'job',
    targetId: p.jobId,
    payload: { via: p.via, dueAt, notes: p.notes ?? null },
  })
  const addr = await addressOf(tx, job.propertyId)
  await tx.insert(notifications).values({
    userId: job.clientId,
    type: 'job',
    title: 'Ready to approve',
    message: `Your job at ${addr} is ready to approve. Check the evidence and approve it within ${p.reviewHours} hours, or tell us what needs changing.`,
    link: `/client/jobs/${p.jobId}`,
  })
  return { ok: true as const, dueAt }
}

/** Approve the finished job. Payment becomes payable to the Pro in the next weekly run. */
export async function approveJob(
  tx: Tx,
  p: { jobId: string; mode: ApprovalMode; actorId: string | null }
): Promise<{ ok: true } | { ok: false; error: string; code: 'not_ready' | 'disputed' }> {
  if (await hasOpenDispute(tx, p.jobId)) {
    return { ok: false, error: 'This job has an open dispute. It can be approved once the dispute is settled.', code: 'disputed' }
  }
  const claimed = await tx
    .update(jobs)
    .set({
      status: 'completed',
      approvedAt: sql`now()`,
      approvalMode: p.mode,
      payoutEligibleAt: sql`now()`,
      clientReviewDueAt: null,
      updatedAt: sql`now()`,
    })
    .where(and(eq(jobs.id, p.jobId), eq(jobs.status, 'reviewed')))
    .returning({
      clientId: jobs.clientId,
      clerkId: jobs.clerkId,
      cleanerId: jobs.cleanerId,
      inspectionType: jobs.inspectionType,
      propertyId: jobs.propertyId,
    })
  if (!claimed.length) return { ok: false, error: 'This job isn’t ready to approve.', code: 'not_ready' }
  const job = claimed[0]
  const isCleaner = roleForType(job.inspectionType) === 'CLEANER'
  const workerId = isCleaner ? job.cleanerId : job.clerkId

  await logAuditEvent(tx, {
    category: 'job_lifecycle',
    action: 'job.approved',
    actorUserId: p.actorId,
    targetType: 'job',
    targetId: p.jobId,
    // AUTO is recorded as such: the window closed, the client did not consent.
    payload: { mode: p.mode },
  })

  if (workerId) {
    await tx
      .update(profiles)
      .set({ clerkJobsCompleted: sql`coalesce(${profiles.clerkJobsCompleted}, 0) + 1`, updatedAt: sql`now()` })
      .where(eq(profiles.userId, workerId))
    await tx.insert(notifications).values({
      userId: workerId,
      type: 'job',
      title: 'Job approved',
      message: `Job ${ref(p.jobId)} was approved. You’ll be paid in the next weekly payout.`,
      link: isCleaner ? '/cleaner/earnings' : '/clerk/earnings',
    })
  }
  if (p.mode !== 'client') {
    await tx.insert(notifications).values({
      userId: job.clientId,
      type: 'job',
      title: p.mode === 'auto' ? 'Job completed automatically' : 'Job completed by LISTD',
      message:
        p.mode === 'auto'
          ? `The review window for job ${ref(p.jobId)} closed with no corrections or dispute, so it has completed.`
          : `LISTD completed job ${ref(p.jobId)}.`,
      link: `/client/jobs/${p.jobId}`,
    })
  }
  return { ok: true }
}

/** The client wants changes: back to the Pro, with the window stopped. */
export async function requestCorrection(tx: Tx, p: { jobId: string; actorId: string; text: string }) {
  const claimed = await tx
    .update(jobs)
    .set({ status: 'in_progress', clientReviewDueAt: null, updatedAt: sql`now()` })
    .where(and(eq(jobs.id, p.jobId), eq(jobs.status, 'reviewed')))
    .returning({ clerkId: jobs.clerkId, cleanerId: jobs.cleanerId, inspectionType: jobs.inspectionType })
  if (!claimed.length) return { ok: false as const, error: 'Corrections can be requested while a job is ready to approve.' }
  const job = claimed[0]
  const isCleaner = roleForType(job.inspectionType) === 'CLEANER'
  const workerId = isCleaner ? job.cleanerId : job.clerkId
  await logAuditEvent(tx, {
    category: 'job_lifecycle',
    action: 'job.correction_requested',
    actorUserId: p.actorId,
    targetType: 'job',
    targetId: p.jobId,
    payload: { text: p.text },
  })
  if (workerId) {
    await tx.insert(notifications).values({
      userId: workerId,
      type: 'job',
      title: 'Client requested corrections',
      message: p.text,
      link: isCleaner ? `/cleaner/jobs/${p.jobId}` : `/clerk/jobs/${p.jobId}`,
    })
  }
  return { ok: true as const }
}

/** Dispute opened: stop the clock so the job can't auto-approve under it. */
export async function pauseReviewForDispute(tx: Tx, jobId: string) {
  await tx.update(jobs).set({ clientReviewDueAt: null, updatedAt: sql`now()` }).where(and(eq(jobs.id, jobId), eq(jobs.status, 'reviewed')))
}

/** Dispute settled: if it was waiting on the client, give them a fresh window. */
export async function resumeReviewAfterDispute(tx: Tx, jobId: string, reviewHours: number) {
  if (await hasOpenDispute(tx, jobId)) return
  const dueAt = new Date(Date.now() + reviewHours * 3600_000).toISOString()
  await tx
    .update(jobs)
    .set({ clientReviewDueAt: dueAt, updatedAt: sql`now()` })
    .where(and(eq(jobs.id, jobId), eq(jobs.status, 'reviewed'), isNull(jobs.clientReviewDueAt)))
}

/** Cron: complete jobs whose window closed. Each runs in its own transaction. */
export async function autoApproveDueJobs(now = new Date()) {
  const due = await withServiceRole((tx) =>
    tx
      .select({ id: jobs.id })
      .from(jobs)
      .where(and(eq(jobs.status, 'reviewed'), isNotNull(jobs.clientReviewDueAt), lte(jobs.clientReviewDueAt, now.toISOString())))
      .limit(200)
  )
  let approved = 0
  for (const { id } of due) {
    const r = await withServiceRole((tx) => approveJob(tx, { jobId: id, mode: 'auto', actorId: null }))
    if (r.ok) approved++
  }
  return { checked: due.length, approved }
}

/** Jobs payable now: approved, payment held, no open dispute. */
export async function payableJobs(tx: Tx) {
  return tx
    .select({ jobId: jobs.id, amountP: escrowTransactions.clerkAmount })
    .from(jobs)
    .innerJoin(escrowTransactions, and(eq(escrowTransactions.jobId, jobs.id), eq(escrowTransactions.status, 'held')))
    .where(
      and(
        isNotNull(jobs.payoutEligibleAt),
        notExists(
          tx
            .select({ one: sql`1` })
            .from(disputes)
            .where(and(eq(disputes.jobId, jobs.id), inArray(disputes.status, OPEN_DISPUTE)))
        )
      )
    )
}

/**
 * Weekly cron: pay every payable job. The Stripe transfer inside
 * releaseEscrowForJob is idempotent per escrow, so a re-run can't double-pay.
 * A Pro without payouts set up stays payable and is picked up next week.
 */
export async function runWeeklyPayouts(release: typeof releaseEscrowForJob = releaseEscrowForJob) {
  const payable = await withServiceRole((tx) => payableJobs(tx))
  const [run] = await withServiceRole((tx) => tx.insert(payoutRuns).values({}).returning({ id: payoutRuns.id }))
  const detail: Array<{ jobId: string; amountP: number; released: boolean; reason?: string }> = []
  let paidCount = 0
  let paidP = 0
  for (const job of payable) {
    const r = await release(job.jobId)
    detail.push({ jobId: job.jobId, amountP: job.amountP, released: r.released, reason: r.reason })
    if (r.released) {
      paidCount++
      paidP += job.amountP
    }
  }
  await withServiceRole((tx) =>
    tx
      .update(payoutRuns)
      .set({ finishedAt: sql`now()`, paidCount, paidP, skippedCount: payable.length - paidCount, detail })
      .where(eq(payoutRuns.id, run.id))
  )
  return { runId: run.id, paidCount, paidP, skippedCount: payable.length - paidCount }
}
