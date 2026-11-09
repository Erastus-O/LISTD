import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { errorResponse, notFound, ok } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import { jobs, withServiceRole } from '@/db'
import { callerIp, callerUserAgent, logAuditEvent } from '@/lib/audit'

export const maxDuration = 15
export const runtime = 'nodejs'

const ALLOWED_STATUSES = [
  'draft',
  'pending',
  'published',
  'accepted',
  'assigned',
  'in_progress',
  'submitted',
  'reviewed',
  'signed',
  'completed',
  'paid',
  'cancelled',
] as const

const RequestSchema = z
  .object({
    status: z.enum(ALLOWED_STATUSES),
    reason: z.string().trim().max(500).optional(),
  })
  .strict()

type Params = Promise<{ jobId: string }>

/**
 * POST /api/admin/jobs/[jobId]/status — generic admin status override
 * (S6c-2). The Lovable surface used this to recover off-path jobs (clerk
 * stuck `in_progress`, etc.) and was previously written as a raw Supabase
 * update with no audit trail.
 *
 * Specific lifecycle paths have their own dedicated handlers (more
 * descriptive payloads + side-effects):
 *   - `assign-clerk` (writes `job.assigned`)
 *   - `cancel` (writes `job.cancelled` + notifies)
 *   - `mark-completed` (writes `job.completed`)
 *
 * Use this generic handler **only** when none of the dedicated routes fit.
 *
 * Audit row: `job_lifecycle/job.status_override` with the prior + new
 * status + reason. Naming the audit action `status_override` (rather than
 * `job.<status>`) keeps a clear distinction between intentional state
 * machine transitions and admin forced flips during incident response.
 *
 * No notifications fire from this path — the assumption is that admins use
 * this for off-path recovery and explicitly notify out-of-band.
 */
export async function POST(req: Request, { params }: { params: Params }) {
  const session = await authorizeRequest('admin')
  if (session instanceof Response) return session

  try {
    const { jobId } = await params
    const body = RequestSchema.parse(await req.json())
    const ip = callerIp(req)
    const ua = callerUserAgent(req)

    const result = await withServiceRole(async (tx) => {
      const [job] = await tx
        .select({ id: jobs.id, status: jobs.status })
        .from(jobs)
        .where(eq(jobs.id, jobId))
        .limit(1)
      if (!job) return { status: 'not_found' as const }
      if (job.status === body.status) return { status: 'noop' as const }

      await tx
        .update(jobs)
        .set({ status: body.status })
        .where(eq(jobs.id, jobId))

      await logAuditEvent(tx, {
        category: 'job_lifecycle',
        action: 'job.status_override',
        actorUserId: session.userId,
        targetType: 'job',
        targetId: jobId,
        payload: {
          priorStatus: job.status,
          newStatus: body.status,
          reason: body.reason ?? null,
          override: true,
        },
        ipAddress: ip,
        userAgent: ua,
      })

      return { status: 'ok' as const, priorStatus: job.status }
    })

    if (result.status === 'not_found') return notFound('Job not found')
    return ok({ success: true, noop: result.status === 'noop' })
  } catch (err) {
    console.error('[admin/jobs/status] error:', err)
    return errorResponse(err)
  }
}
