import { pauseReviewForDispute } from '@/lib/listd/lifecycle'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import {
  badRequest,
  errorResponse,
  notFound,
  ok,
} from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import { disputes, jobs, notifications, withServiceRole } from '@/db'
import { callerIp, callerUserAgent, logAuditEvent } from '@/lib/audit'

export const maxDuration = 10
export const runtime = 'nodejs'

const RequestSchema = z
  .object({
    /** The party the dispute is opened against. Must be either the
     *  client or the assigned clerk on this job — we hard-validate
     *  against the row rather than trusting the form. */
    raisedAgainst: z.string().uuid(),
    reason: z.string().trim().min(1).max(200),
    description: z.string().trim().max(4000).optional(),
  })
  .strict()

type Params = Promise<{ jobId: string }>

/**
 * POST /api/admin/jobs/[jobId]/raise-dispute — admin opens a dispute on a
 * job. Writes a `disputes` row + a `dispute/dispute.opened` audit event,
 * notifies the target party.
 *
 * `raisedAgainst` is validated against `jobs.client_id` / `jobs.clerk_id`
 * to stop the form from being used as an arbitrary "raise dispute against
 * any UUID" surface — disputes only make sense in the context of the job's
 * actual counterparties.
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
          clientId: jobs.clientId,
          clerkId: jobs.clerkId,
          status: jobs.status,
        })
        .from(jobs)
        .where(eq(jobs.id, jobId))
        .limit(1)
      if (!job) return { status: 'not_found' as const }

      const allowed = new Set<string>([job.clientId])
      if (job.clerkId) allowed.add(job.clerkId)
      if (!allowed.has(body.raisedAgainst)) {
        return { status: 'bad_target' as const }
      }
      const role = body.raisedAgainst === job.clientId ? 'client' : 'clerk'
      // A dispute stops the client's review clock and freezes the payout.
      await pauseReviewForDispute(tx, jobId)

      const [dispute] = await tx
        .insert(disputes)
        .values({
          jobId,
          raisedBy: session.userId,
          raisedAgainst: body.raisedAgainst,
          reason: body.reason,
          description: body.description ?? null,
          status: 'open',
        })
        .returning({ id: disputes.id })

      await logAuditEvent(tx, {
        category: 'dispute',
        action: 'dispute.opened',
        actorUserId: session.userId,
        targetType: 'dispute',
        targetId: dispute.id,
        payload: {
          jobId,
          jobStatus: job.status,
          raisedAgainst: body.raisedAgainst,
          raisedAgainstRole: role,
          reason: body.reason,
          hasDescription: !!body.description,
        },
        ipAddress: ip,
        userAgent: ua,
      })

      const refSlug = jobId.slice(0, 8)
      await tx.insert(notifications).values([
        {
          userId: body.raisedAgainst,
          type: 'dispute',
          title: 'Dispute opened',
          message: `An admin has opened a dispute on job ${refSlug}: "${body.reason}".`,
          link: '/disputes',
        },
      ])

      return { status: 'ok' as const, disputeId: dispute.id }
    })

    if (result.status === 'not_found') return notFound('Job not found')
    if (result.status === 'bad_target') {
      return badRequest(
        'Dispute target must be the client or the assigned clerk.'
      )
    }
    return ok({ success: true, disputeId: result.disputeId })
  } catch (err) {
    console.error('[admin/jobs/raise-dispute] error:', err)
    return errorResponse(err)
  }
}
