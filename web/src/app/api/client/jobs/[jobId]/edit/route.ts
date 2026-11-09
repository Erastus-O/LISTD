import { and, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import {
  badRequest,
  conflict,
  errorResponse,
  forbidden,
  notFound,
  ok,
} from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import {
  jobs,
  notifications,
  organisationMembers,
  withServiceRole,
} from '@/db'
import { callerIp, callerUserAgent, logAuditEvent } from '@/lib/audit'

export const maxDuration = 10
export const runtime = 'nodejs'

const EDITABLE_STATUSES = ['draft', 'pending', 'published'] as const

const RequestSchema = z
  .object({
    scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    preferredTimeSlot: z.string().trim().max(40).nullable().optional(),
    specialInstructions: z.string().trim().max(2000).nullable().optional(),
  })
  .strict()
  .refine(
    (b) =>
      b.scheduledDate !== undefined ||
      b.preferredTimeSlot !== undefined ||
      b.specialInstructions !== undefined,
    'At least one field must be edited'
  )

type Params = Promise<{ jobId: string }>

/**
 * POST /api/client/jobs/[jobId]/edit — edit a job after it's been posted
 * but before a clerk has accepted it.
 *
 * Permission model:
 *   - The job's `client_id` (owner/worker who created it) can edit.
 *   - Any org owner of the job's `organisation_id` can also edit (so an
 *     owner can correct a worker's posting).
 *
 * Status gate:
 *   - `EDITABLE_STATUSES` covers draft/pending/published. The moment a
 *     clerk accepts (or any later status), edits are blocked here —
 *     admin overrides go through `/api/admin/jobs/[id]/*`.
 *
 * Notifications: when an owner edits a worker's job, the worker is
 * notified so they don't get confused by changes they didn't make. The
 * worker editing their own job triggers no notification — they already
 * know what they did.
 *
 * Audit: `job_lifecycle/job.edited` with the changed fields' previous +
 * next values.
 */
export async function POST(req: Request, { params }: { params: Params }) {
  const session = await authorizeRequest('client', 'admin')
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
          createdByUserId: jobs.createdByUserId,
          organisationId: jobs.organisationId,
          scheduledDate: jobs.scheduledDate,
          preferredTimeSlot: jobs.preferredTimeSlot,
          specialInstructions: jobs.specialInstructions,
        })
        .from(jobs)
        .where(eq(jobs.id, jobId))
        .limit(1)
      if (!job) return { status: 'not_found' as const }

      const isAdmin = session.roles.includes('admin')
      const isCreator =
        job.createdByUserId === session.userId ||
        job.clientId === session.userId
      let isOwner = false
      if (job.organisationId) {
        const [membership] = await tx
          .select({ orgRole: organisationMembers.orgRole })
          .from(organisationMembers)
          .where(
            and(
              eq(organisationMembers.userId, session.userId),
              eq(organisationMembers.organisationId, job.organisationId),
              eq(organisationMembers.status, 'active')
            )
          )
          .limit(1)
        isOwner = membership?.orgRole === 'owner'
      }
      if (!isAdmin && !isCreator && !isOwner) {
        return { status: 'forbidden' as const }
      }
      if (
        !(EDITABLE_STATUSES as readonly string[]).includes(job.status)
      ) {
        return { status: 'wrong_state' as const, current: job.status }
      }

      // Build the patch + diff for the audit row. Skip fields the caller
      // didn't include in their payload (undefined means "don't touch").
      const patch: Record<string, unknown> = {}
      const diff: Record<string, { from: unknown; to: unknown }> = {}
      if (body.scheduledDate !== undefined) {
        patch.scheduledDate = body.scheduledDate
        diff.scheduledDate = { from: job.scheduledDate, to: body.scheduledDate }
      }
      if (body.preferredTimeSlot !== undefined) {
        patch.preferredTimeSlot = body.preferredTimeSlot
        diff.preferredTimeSlot = {
          from: job.preferredTimeSlot,
          to: body.preferredTimeSlot,
        }
      }
      if (body.specialInstructions !== undefined) {
        patch.specialInstructions = body.specialInstructions
        diff.specialInstructions = {
          from: job.specialInstructions,
          to: body.specialInstructions,
        }
      }
      if (Object.keys(patch).length === 0) {
        return { status: 'noop' as const }
      }

      // A date/slot change invalidates any exact arrival commitment
      // (`scheduled_at` is set at accept or by an admin — 0038 follow-up).
      // These jobs are pre-accept so it's almost always null already, but
      // an admin may have pre-set a time; stale times mis-fire the
      // missed check-in alarm, so clear rather than keep.
      if (patch.scheduledDate !== undefined || patch.preferredTimeSlot !== undefined) {
        patch.scheduledAt = null
      }

      await tx
        .update(jobs)
        .set({ ...patch, updatedAt: sql`now()` })
        .where(
          and(
            eq(jobs.id, jobId),
            // Optimistic-claim guard: refuse if the job has been accepted
            // between our SELECT and UPDATE.
            sql`${jobs.status} = ANY(${sql.raw(
              `ARRAY[${EDITABLE_STATUSES.map((s) => `'${s}'`).join(',')}]::job_status[]`
            )})`
          )
        )

      await logAuditEvent(tx, {
        category: 'job_lifecycle',
        action: 'job.edited',
        actorUserId: session.userId,
        targetType: 'job',
        targetId: jobId,
        payload: {
          editedBy: isOwner && !isCreator ? 'owner_on_workers_job' : 'self',
          status: job.status,
          diff,
        },
        ipAddress: ip,
        userAgent: ua,
      })

      // If an owner edited a worker's job, notify the worker so they don't
      // get surprised by changes they didn't make.
      if (
        isOwner &&
        !isCreator &&
        job.createdByUserId &&
        job.createdByUserId !== session.userId
      ) {
        const refSlug = jobId.slice(0, 8)
        await tx.insert(notifications).values([
          {
            userId: job.createdByUserId,
            type: 'job',
            title: 'Your job was edited',
            message: `Your organisation owner updated job ${refSlug}. Open it to see the changes.`,
            link: `/client/jobs/${jobId}`,
          },
        ])
      }

      return { status: 'ok' as const }
    })

    if (result.status === 'not_found') return notFound('Job not found')
    if (result.status === 'forbidden') return forbidden('Not allowed.')
    if (result.status === 'wrong_state') {
      return conflict(
        `Job is currently '${result.current}' and can't be edited from here.`
      )
    }
    if (result.status === 'noop') return badRequest('No changes provided.')
    return ok({ success: true })
  } catch (err) {
    console.error('[client/jobs/edit] error:', err)
    return errorResponse(err)
  }
}
