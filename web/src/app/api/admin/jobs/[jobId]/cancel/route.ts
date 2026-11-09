import { eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { errorResponse, notFound, ok } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import { jobs, notifications, withServiceRole } from '@/db'
import { callerIp, callerUserAgent, logAuditEvent } from '@/lib/audit'
import { notifyUserSms } from '@/lib/notify-prefs'
import { refundEscrowForJob } from '@/lib/billing/escrow'

export const maxDuration = 15
export const runtime = 'nodejs'

const RequestSchema = z
  .object({
    reason: z.string().trim().max(2000).optional(),
    cancellationFee: z.number().min(0).max(1_000_000).optional(),
  })
  .strict()

type Params = Promise<{ jobId: string }>

/**
 * POST /api/admin/jobs/[jobId]/cancel — admin cancels a job (S6c-2; closes
 * the `job.cancelled` audit-event site of M1 #22 Package C).
 *
 * Atomic in one tx:
 *   - Flips `status='cancelled'`, stamps `cancelled_at=now()`,
 *     `cancelled_by=adminId`, `cancellation_fee` (defaults to 0).
 *   - Writes `job_lifecycle/job.cancelled` audit row with the prior status,
 *     reason, and fee.
 *   - Notifies the client and the assigned clerk (if any).
 */
export async function POST(req: Request, { params }: { params: Params }) {
  const session = await authorizeRequest('admin')
  if (session instanceof Response) return session

  try {
    const { jobId } = await params
    const body = RequestSchema.parse(await req.json())
    const ip = callerIp(req)
    const ua = callerUserAgent(req)
    const fee = body.cancellationFee ?? 0

    const result = await withServiceRole(async (tx) => {
      const [job] = await tx
        .select({
          id: jobs.id,
          status: jobs.status,
          clientId: jobs.clientId,
          clerkId: jobs.clerkId,
        })
        .from(jobs)
        .where(eq(jobs.id, jobId))
        .limit(1)
      if (!job) return { status: 'not_found' as const }
      if (job.status === 'cancelled') {
        return { status: 'noop' as const }
      }

      await tx
        .update(jobs)
        .set({
          status: 'cancelled',
          cancelledAt: sql`now()`,
          cancelledBy: session.userId,
          cancellationFee: fee.toFixed(2),
        })
        .where(eq(jobs.id, jobId))

      await logAuditEvent(tx, {
        category: 'job_lifecycle',
        action: 'job.cancelled',
        actorUserId: session.userId,
        targetType: 'job',
        targetId: jobId,
        payload: {
          priorStatus: job.status,
          cancellationFee: fee.toFixed(2),
          reason: body.reason ?? null,
        },
        ipAddress: ip,
        userAgent: ua,
      })

      const refSlug = jobId.slice(0, 8)
      const reasonClause = body.reason ? ` Reason: ${body.reason}` : ''
      const notificationRows = [
        {
          userId: job.clientId,
          type: 'job' as const,
          title: 'Job cancelled',
          message: `Job ${refSlug} has been cancelled by admin.${reasonClause}`,
          link: `/client/jobs/${jobId}`,
        },
      ]
      if (job.clerkId) {
        notificationRows.push({
          userId: job.clerkId,
          type: 'job' as const,
          title: 'Job cancelled',
          message: `Job ${refSlug} has been cancelled.${reasonClause}`,
          link: `/clerk/jobs`,
        })
      }
      await tx.insert(notifications).values(notificationRows)

      return {
        status: 'ok' as const,
        smsTargets: notificationRows.map((n) => n.userId),
        refSlug,
        reasonClause,
      }
    })

    if (result.status === 'not_found') return notFound('Job not found')

    // Job-cancelled SMS to the client + assigned clerk (gated by
    // `smsJobUpdates` + phone). Best-effort, post-commit.
    if (result.status === 'ok') {
      const smsBody =
        `LISTD: Inspection ${result.refSlug} has been cancelled.${result.reasonClause}`.slice(
          0,
          300
        )
      await Promise.allSettled(
        result.smsTargets.map((userId) =>
          notifyUserSms(userId, 'smsJobUpdates', smsBody)
        )
      )

      // Refund the client's held escrow (best-effort; no-ops if there's no
      // held escrow for this job).
      await refundEscrowForJob(jobId).catch((e) =>
        console.warn('[admin/jobs/cancel] escrow refund failed:', e)
      )
    }

    return ok({ success: true, alreadyCancelled: result.status === 'noop' })
  } catch (err) {
    console.error('[admin/jobs/cancel] error:', err)
    return errorResponse(err)
  }
}
