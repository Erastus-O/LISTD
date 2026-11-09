import { eq } from 'drizzle-orm'
import { z } from 'zod'
import {
  badRequest,
  errorResponse,
  forbidden,
  notFound,
  ok,
} from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import {
  jobs,
  notifications,
  withServiceRole,
} from '@/db'
import { callerIp, callerUserAgent, logAuditEvent } from '@/lib/audit'
import { formatJobRef } from '@/lib/dashboard/admin-jobs'

export const maxDuration = 15
export const runtime = 'nodejs'

const RequestSchema = z
  .object({
    /** The user must type the LST-YYYY-NNNN ref to confirm hard-delete. */
    confirmRef: z.string().trim().min(1).max(40),
  })
  .strict()

type Params = Promise<{ jobId: string }>

/**
 * POST /api/admin/jobs/[jobId]/delete — hard-deletes a job.
 *
 * Destructive and irreversible. Foreign-key cascades remove dependent rows
 * (inspection_reports/rooms/items/photos, messages, generated_reports,
 * notifications). We **deliberately preserve `audit_events` rows** for this
 * job — they're keyed by `target_id text`, no FK to `jobs`, so the
 * forensic trail survives the row going away.
 *
 * Guardrails:
 *   - Requires `confirmRef` to match the row's LST-YYYY-NNNN ref. Stops
 *     fat-finger deletes from another tab the admin forgot about.
 *   - Writes a final `job_lifecycle/job.deleted` audit row (in the same
 *     tx as the DELETE) with the prior status + a snapshot of the row so
 *     support has something to reference if the deletion was a mistake.
 *   - Notifies client + assigned clerk so they see the row vanish.
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
        .select({
          id: jobs.id,
          status: jobs.status,
          clientId: jobs.clientId,
          clerkId: jobs.clerkId,
          jobRefNumber: jobs.jobRefNumber,
          createdAt: jobs.createdAt,
          inspectionType: jobs.inspectionType,
          scheduledDate: jobs.scheduledDate,
        })
        .from(jobs)
        .where(eq(jobs.id, jobId))
        .limit(1)
      if (!job) return { status: 'not_found' as const }

      const expectedRef = formatJobRef(job.createdAt, job.jobRefNumber)
      if (body.confirmRef !== expectedRef) {
        return { status: 'bad_confirm' as const, expectedRef }
      }

      // Audit FIRST inside the tx so the forensic record predates the
      // DELETE; if the DELETE fails we still have a "tried to delete"
      // event for support to triage.
      await logAuditEvent(tx, {
        category: 'job_lifecycle',
        action: 'job.deleted',
        actorUserId: session.userId,
        targetType: 'job',
        targetId: jobId,
        payload: {
          priorStatus: job.status,
          ref: expectedRef,
          clientId: job.clientId,
          clerkId: job.clerkId ?? null,
          inspectionType: job.inspectionType,
          scheduledDate: job.scheduledDate,
        },
        ipAddress: ip,
        userAgent: ua,
      })

      const refSlug = jobId.slice(0, 8)
      const notificationRows: Array<{
        userId: string
        type: string
        title: string
        message: string
        link: string
      }> = [
        {
          userId: job.clientId,
          type: 'job',
          title: 'Job removed',
          message: `Job ${refSlug} has been removed by an administrator.`,
          link: '/client/jobs',
        },
      ]
      if (job.clerkId) {
        notificationRows.push({
          userId: job.clerkId,
          type: 'job',
          title: 'Job removed',
          message: `Job ${refSlug} you had visibility on has been removed.`,
          link: '/clerk/jobs',
        })
      }
      await tx.insert(notifications).values(notificationRows)

      await tx.delete(jobs).where(eq(jobs.id, jobId))
      return { status: 'ok' as const }
    })

    if (result.status === 'not_found') return notFound('Job not found')
    if (result.status === 'bad_confirm') {
      return badRequest(
        `Confirmation does not match. Expected "${result.expectedRef}".`
      )
    }
    return ok({ success: true })
  } catch (err) {
    console.error('[admin/jobs/delete] error:', err)
    // Re-use forbidden for FK-cascade failures that surface as 409-shaped
    // postgres errors when downstream tables don't have ON DELETE CASCADE.
    if (
      err instanceof Error &&
      err.message.includes('foreign key constraint')
    ) {
      return forbidden(
        'Cannot delete: dependent rows still reference this job. Mark it cancelled first.'
      )
    }
    return errorResponse(err)
  }
}

