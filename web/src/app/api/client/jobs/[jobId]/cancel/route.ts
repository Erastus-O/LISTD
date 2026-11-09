import { and, eq, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import { conflict, errorResponse, forbidden, notFound, ok } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import {
  jobs,
  notifications,
  organisationMembers,
  withServiceRole,
} from '@/db'
import { callerIp, callerUserAgent, logAuditEvent } from '@/lib/audit'
import { notifyUserSms } from '@/lib/notify-prefs'
import { refundEscrowForJob } from '@/lib/billing/escrow'

export const maxDuration = 15
export const runtime = 'nodejs'

const RequestSchema = z
  .object({
    reason: z.string().trim().max(2000).optional(),
  })
  .strict()

type Params = Promise<{ jobId: string }>

// Statuses a client can self-cancel without admin involvement. Beyond
// `accepted`, cancellation has financial implications (clerk has time
// committed) and routes through admin / dispute flow instead.
const CLIENT_CANCELLABLE = ['draft', 'pending', 'published'] as const

/**
 * POST /api/client/jobs/[jobId]/cancel — client-initiated cancellation of
 * their own job. Mirrors the admin cancel handler but enforces ownership
 * server-side: caller must be the job's `client_id` OR an active member of
 * its `organisation_id`.
 *
 * Atomic in one tx:
 *   - Status → `cancelled`, stamps `cancelled_at` / `cancelled_by`. Fee
 *     defaults to 0 on the client path; admins use the dedicated handler
 *     when a fee applies.
 *   - Writes `job_lifecycle/job.cancelled` audit row with `via='client'`
 *     so consumers can distinguish self-cancels from admin actions.
 *   - Notifies the assigned clerk if any. (No client notification — the
 *     client just performed the action.)
 */
export async function POST(req: Request, { params }: { params: Params }) {
  const session = await authorizeRequest('client', 'admin')
  if (session instanceof Response) return session

  try {
    const { jobId } = await params
    const body = RequestSchema.parse(await req.json().catch(() => ({})))
    const ip = callerIp(req)
    const ua = callerUserAgent(req)

    const result = await withServiceRole(async (tx) => {
      const [job] = await tx
        .select({
          id: jobs.id,
          clientId: jobs.clientId,
          clerkId: jobs.clerkId,
          organisationId: jobs.organisationId,
          status: jobs.status,
        })
        .from(jobs)
        .where(eq(jobs.id, jobId))
        .limit(1)
      if (!job) return { status: 'not_found' as const }

      // Ownership check — direct client_id or active org member.
      let isOwner = job.clientId === session.userId
      if (!isOwner && job.organisationId) {
        const [membership] = await tx
          .select({ id: organisationMembers.id })
          .from(organisationMembers)
          .where(
            and(
              eq(organisationMembers.organisationId, job.organisationId),
              eq(organisationMembers.userId, session.userId),
              eq(organisationMembers.status, 'active')
            )
          )
          .limit(1)
        isOwner = Boolean(membership)
      }
      // Admins can always cancel via their own handler — no client-handler
      // bypass for them, since the admin route writes a richer audit row
      // and supports a cancellation fee.
      if (!isOwner) return { status: 'forbidden' as const }

      if (
        !(CLIENT_CANCELLABLE as readonly string[]).includes(job.status)
      ) {
        return { status: 'wrong_state' as const, current: job.status }
      }

      await tx
        .update(jobs)
        .set({
          status: 'cancelled',
          cancelledAt: sql`now()`,
          cancelledBy: session.userId,
          cancellationFee: '0.00',
        })
        .where(
          and(
            eq(jobs.id, jobId),
            inArray(jobs.status, [...CLIENT_CANCELLABLE])
          )
        )

      await logAuditEvent(tx, {
        category: 'job_lifecycle',
        action: 'job.cancelled',
        actorUserId: session.userId,
        targetType: 'job',
        targetId: jobId,
        payload: {
          priorStatus: job.status,
          via: 'client',
          reason: body.reason ?? null,
        },
        ipAddress: ip,
        userAgent: ua,
      })

      if (job.clerkId) {
        await tx.insert(notifications).values({
          userId: job.clerkId,
          type: 'job',
          title: 'Job cancelled',
          message: `Job ${jobId.slice(0, 8)} was cancelled by the client${
            body.reason ? `. Reason: ${body.reason}` : '.'
          }`,
          link: `/clerk/jobs`,
        })
      }

      // The client cancelled, so they already know — SMS only the
      // assigned clerk (if any). Fired after commit.
      return {
        status: 'ok' as const,
        clerkId: job.clerkId ?? null,
        refSlug: jobId.slice(0, 8),
        reason: body.reason ?? null,
      }
    })

    if (result.status === 'not_found') return notFound('Job not found')
    if (result.status === 'forbidden') return forbidden('Not your job')
    if (result.status === 'wrong_state') {
      return conflict(
        `Cannot cancel from status ${result.current}. Contact support if a clerk has already accepted.`
      )
    }

    // Job-cancelled SMS to the assigned clerk (gated by `smsJobUpdates`
    // + phone). Best-effort, post-commit.
    if (result.status === 'ok' && result.clerkId) {
      const reasonClause = result.reason ? ` Reason: ${result.reason}` : ''
      const smsBody =
        `LISTD: Job ${result.refSlug} was cancelled by the client.${reasonClause}`.slice(
          0,
          300
        )
      await notifyUserSms(result.clerkId, 'smsJobUpdates', smsBody)
    }

    // Refund the client's held escrow on cancellation (best-effort; no-ops if
    // there's no held escrow).
    if (result.status === 'ok') {
      await refundEscrowForJob(jobId).catch((e) =>
        console.warn('[client/jobs/cancel] escrow refund failed:', e)
      )
    }

    return ok({ success: true })
  } catch (err) {
    console.error('[client/jobs/cancel] error:', err)
    return errorResponse(err)
  }
}
