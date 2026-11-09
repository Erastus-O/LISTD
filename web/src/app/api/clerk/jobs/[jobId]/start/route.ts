import { and, eq } from 'drizzle-orm'
import { conflict, errorResponse, forbidden, notFound, ok } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import { jobs, withServiceRole } from '@/db'
import { callerIp, callerUserAgent, logAuditEvent } from '@/lib/audit'

export const maxDuration = 15
export const runtime = 'nodejs'

type Params = Promise<{ jobId: string }>

/**
 * POST /api/clerk/jobs/[jobId]/start — clerk flips an `accepted` job to
 * `in_progress` when they begin the inspection on-site. Closes the
 * `job.in_progress` lifecycle audit site (M1 #22 Package C — clerk
 * self-start path; the QA-return path also writes this action with a
 * different `reason` payload).
 *
 * Atomic in one tx with the optimistic claim: the UPDATE WHERE clause
 * pins `clerk_id = caller AND status = 'accepted'`, so a race (admin
 * status-override, double-click) falls through to a 409.
 */
export async function POST(req: Request, { params }: { params: Params }) {
  const session = await authorizeRequest('clerk', 'trades', 'admin')
  if (session instanceof Response) return session

  try {
    const { jobId } = await params
    const ip = callerIp(req)
    const ua = callerUserAgent(req)

    const result = await withServiceRole(async (tx) => {
      const [job] = await tx
        .select({
          id: jobs.id,
          clerkId: jobs.clerkId,
          status: jobs.status,
        })
        .from(jobs)
        .where(eq(jobs.id, jobId))
        .limit(1)
      if (!job) return { status: 'not_found' as const }
      if (job.clerkId !== session.userId) {
        return { status: 'forbidden' as const }
      }
      if (job.status !== 'accepted') {
        return { status: 'wrong_state' as const, current: job.status }
      }

      const updated = await tx
        .update(jobs)
        .set({ status: 'in_progress' })
        .where(
          and(
            eq(jobs.id, jobId),
            eq(jobs.clerkId, session.userId),
            eq(jobs.status, 'accepted')
          )
        )
        .returning({ id: jobs.id })
      if (updated.length === 0) {
        return { status: 'race' as const }
      }

      await logAuditEvent(tx, {
        category: 'job_lifecycle',
        action: 'job.in_progress',
        actorUserId: session.userId,
        targetType: 'job',
        targetId: jobId,
        payload: {
          priorStatus: 'accepted',
          via: 'clerk_self_start',
        },
        ipAddress: ip,
        userAgent: ua,
      })

      return { status: 'ok' as const }
    })

    if (result.status === 'not_found') return notFound('Job not found')
    if (result.status === 'forbidden') return forbidden('Not your job')
    if (result.status === 'wrong_state') {
      return conflict(
        `Job is currently '${result.current}', cannot mark in progress`
      )
    }
    if (result.status === 'race') {
      return conflict('Job state changed concurrently : refresh and retry')
    }
    return ok({ success: true })
  } catch (err) {
    console.error('[clerk/jobs/start] error:', err)
    return errorResponse(err)
  }
}
