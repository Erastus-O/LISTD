import { eq, sql } from 'drizzle-orm'
import { errorResponse, notFound, ok } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import { jobs, withServiceRole } from '@/db'
import { callerIp, callerUserAgent, logAuditEvent } from '@/lib/audit'

export const maxDuration = 15
export const runtime = 'nodejs'

type Params = Promise<{ jobId: string }>

/**
 * POST /api/admin/jobs/[jobId]/mark-completed — admin force-completes a job
 * (S6c-2; closes the `job.completed` audit-event site of M1 #22 Package C).
 *
 * Lovable's surface called this "Mark as Completed" and used it to recover
 * from a clerk forgetting to update status. We keep the same UX intent but
 * audit it explicitly.
 *
 * Atomic in one tx:
 *   - Flips `status='completed'`. Stamps `delivered_at=now()` if it isn't
 *     already set (preserves the original delivery timestamp when present).
 *   - Writes `job_lifecycle/job.completed` audit row with the prior status
 *     + final price + clerk payout snapshot, so reconstruction is possible
 *     even if those values are later overridden.
 */
export async function POST(req: Request, { params }: { params: Params }) {
  const session = await authorizeRequest('admin')
  if (session instanceof Response) return session

  try {
    const { jobId } = await params
    const ip = callerIp(req)
    const ua = callerUserAgent(req)

    const result = await withServiceRole(async (tx) => {
      const [job] = await tx
        .select({
          id: jobs.id,
          status: jobs.status,
          deliveredAt: jobs.deliveredAt,
          finalPrice: jobs.finalPrice,
          quotedPrice: jobs.quotedPrice,
          clerkFinalPayout: jobs.clerkFinalPayout,
          clerkPayout: jobs.clerkPayout,
        })
        .from(jobs)
        .where(eq(jobs.id, jobId))
        .limit(1)
      if (!job) return { status: 'not_found' as const }
      if (job.status === 'completed' || job.status === 'paid') {
        return { status: 'noop' as const }
      }

      await tx
        .update(jobs)
        .set({
          status: 'completed',
          // Preserve any existing delivery timestamp; only stamp now() when
          // the field was empty.
          deliveredAt: job.deliveredAt ?? (sql`now()` as unknown as string),
        })
        .where(eq(jobs.id, jobId))

      await logAuditEvent(tx, {
        category: 'job_lifecycle',
        action: 'job.completed',
        actorUserId: session.userId,
        targetType: 'job',
        targetId: jobId,
        payload: {
          priorStatus: job.status,
          finalPrice: job.finalPrice ?? job.quotedPrice ?? null,
          clerkFinalPayout: job.clerkFinalPayout ?? job.clerkPayout ?? null,
          forced: true,
        },
        ipAddress: ip,
        userAgent: ua,
      })

      return { status: 'ok' as const }
    })

    if (result.status === 'not_found') return notFound('Job not found')
    return ok({ success: true, alreadyCompleted: result.status === 'noop' })
  } catch (err) {
    console.error('[admin/jobs/mark-completed] error:', err)
    return errorResponse(err)
  }
}
