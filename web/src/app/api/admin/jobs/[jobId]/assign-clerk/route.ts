import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { errorResponse, notFound, ok } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import { jobs, notifications, profiles, withServiceRole } from '@/db'
import { callerIp, callerUserAgent, logAuditEvent } from '@/lib/audit'

export const maxDuration = 15
export const runtime = 'nodejs'

const RequestSchema = z
  .object({
    clerkId: z.string().uuid(),
    /** Optional rationale captured in the audit payload. */
    reason: z.string().trim().max(500).optional(),
  })
  .strict()

type Params = Promise<{ jobId: string }>

/**
 * POST /api/admin/jobs/[jobId]/assign-clerk — admin assigns (or reassigns)
 * a clerk to a job (S6c-2; closes the `job.assigned` audit-event site of
 * M1 #22 Package C).
 *
 * Atomic in one tx:
 *   - Updates `jobs.clerk_id` + flips `status` to `assigned` + stamps
 *     `assigned_by` to the acting admin.
 *   - Writes `job_lifecycle/job.assigned` audit row with the prior clerk +
 *     prior status, so reassignment history is reconstructable.
 *   - Inserts an in-app notification to the assigned clerk.
 *
 * The `assigned_by_name` column expects a string fallback — we resolve it
 * from the admin's profile inside the same tx so there's only one extra
 * SELECT instead of a denormalised cache.
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
          clerkId: jobs.clerkId,
        })
        .from(jobs)
        .where(eq(jobs.id, jobId))
        .limit(1)
      if (!job) return { status: 'not_found' as const }

      const [adminProfile] = await tx
        .select({ fullName: profiles.fullName })
        .from(profiles)
        .where(eq(profiles.userId, session.userId))
        .limit(1)

      await tx
        .update(jobs)
        .set({
          clerkId: body.clerkId,
          status: 'assigned',
          assignedBy: session.userId,
          assignedByName: adminProfile?.fullName ?? null,
        })
        .where(eq(jobs.id, jobId))

      await logAuditEvent(tx, {
        category: 'job_lifecycle',
        action: 'job.assigned',
        actorUserId: session.userId,
        targetType: 'job',
        targetId: jobId,
        payload: {
          clerkId: body.clerkId,
          priorClerkId: job.clerkId,
          priorStatus: job.status,
          reason: body.reason ?? null,
        },
        ipAddress: ip,
        userAgent: ua,
      })

      await tx.insert(notifications).values({
        userId: body.clerkId,
        type: 'job',
        title: 'Job assigned to you',
        message: `Admin assigned you to job ${jobId.slice(0, 8)}.`,
        link: `/clerk/jobs/${jobId}`,
      })

      return { status: 'ok' as const }
    })

    if (result.status === 'not_found') return notFound('Job not found')
    return ok({ success: true })
  } catch (err) {
    console.error('[admin/jobs/assign-clerk] error:', err)
    return errorResponse(err)
  }
}
