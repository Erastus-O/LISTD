import { resumeReviewAfterDispute } from '@/lib/listd/lifecycle'
import { getPricing } from '@/lib/listd/pricing-settings'
import { eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { errorResponse, notFound, ok } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import {
  disputes,
  jobs,
  notifications,
  properties,
  withServiceRole,
} from '@/db'
import { callerIp, callerUserAgent, logAuditEvent } from '@/lib/audit'

export const maxDuration = 15
export const runtime = 'nodejs'

const STATUSES = ['open', 'under_review', 'resolved', 'escalated'] as const

const RequestSchema = z
  .object({
    status: z.enum(STATUSES),
    /** Resolution narrative, required when transitioning to `resolved`. */
    resolution: z.string().trim().max(2000).optional(),
    /** Internal admin notes, not surfaced to either party. */
    adminNotes: z.string().trim().max(2000).optional(),
  })
  .strict()
  .refine(
    (b) =>
      b.status !== 'resolved' || (b.resolution && b.resolution.length > 0),
    {
      message: 'Resolution narrative is required when status = resolved',
      path: ['resolution'],
    }
  )

type Params = Promise<{ disputeId: string }>

/**
 * POST /api/admin/disputes/[disputeId]/resolve — admin transitions a dispute
 * (open → under_review / resolved / escalated). Atomic in one tx:
 *
 *   - Updates `disputes.status` (+ `resolution` / `adminNotes` / `resolvedBy`
 *     / `resolvedAt` when applicable).
 *   - Writes a `dispute/dispute.<newStatus>` audit row alongside the update
 *     so the unified `audit_events` view answers "all admin actions in
 *     window X" without having to join `disputes` separately. Audit row
 *     `targetType='dispute'`, `targetId=disputeId` so the dispute detail
 *     page can surface its own trail.
 *   - Notifies the client + assigned clerk on resolution / escalation.
 *
 * **Strike issuance during resolution** is intentionally NOT folded in —
 * admins call the existing [`/api/admin/clerks/[id]/strike`](../../../clerks/[clerkId]/strike/route.ts)
 * endpoint separately so the strike has its own audit row + clerk notification.
 */
export async function POST(req: Request, { params }: { params: Params }) {
  const session = await authorizeRequest('admin')
  if (session instanceof Response) return session

  try {
    const { disputeId } = await params
    const body = RequestSchema.parse(await req.json())
    const ip = callerIp(req)
    const ua = callerUserAgent(req)

    const result = await withServiceRole(async (tx) => {
      const [existing] = await tx
        .select({
          id: disputes.id,
          status: disputes.status,
          jobId: disputes.jobId,
        })
        .from(disputes)
        .where(eq(disputes.id, disputeId))
        .limit(1)
      if (!existing) return { status: 'not_found' as const }
      if (existing.status === body.status && !body.resolution && !body.adminNotes) {
        return { status: 'noop' as const }
      }

      const isResolving = body.status === 'resolved'
      await tx
        .update(disputes)
        .set({
          status: body.status,
          resolution:
            body.resolution !== undefined
              ? body.resolution
              : undefined,
          adminNotes:
            body.adminNotes !== undefined
              ? body.adminNotes
              : undefined,
          resolvedBy: isResolving ? session.userId : undefined,
          resolvedAt: isResolving ? sql`now()` : undefined,
          updatedAt: sql`now()`,
        })
        .where(eq(disputes.id, disputeId))

      // Settled: if the job was waiting on the client, they get a fresh window.
      if (isResolving && existing.jobId) {
        const pricing = await getPricing()
        await resumeReviewAfterDispute(tx, existing.jobId, pricing.reviewHours)
      }

      // Audit row in the same tx — partial failure can't leave a status
      // flip without the matching forensic record. Action namespaces by
      // new status (e.g. `dispute.resolved`) so consumers can filter by
      // outcome without parsing payload.
      await logAuditEvent(tx, {
        category: 'dispute',
        action: `dispute.${body.status}`,
        actorUserId: session.userId,
        targetType: 'dispute',
        targetId: disputeId,
        payload: {
          priorStatus: existing.status,
          newStatus: body.status,
          jobId: existing.jobId,
          resolution: body.resolution ?? null,
          adminNotes: body.adminNotes ?? null,
        },
        ipAddress: ip,
        userAgent: ua,
      })

      // Notify both parties when resolving / escalating. Skip notifications
      // for the open ↔ under_review transition since that's an internal
      // admin workflow signal, not a user-facing event.
      if (body.status === 'resolved' || body.status === 'escalated') {
        const [job] = await tx
          .select({
            id: jobs.id,
            clientId: jobs.clientId,
            clerkId: jobs.clerkId,
            propertyId: jobs.propertyId,
            addressLine1: properties.addressLine1,
            postcode: properties.postcode,
          })
          .from(jobs)
          .leftJoin(properties, eq(properties.id, jobs.propertyId))
          .where(eq(jobs.id, existing.jobId))
          .limit(1)
        if (job) {
          const addr = job.addressLine1
            ? `${job.addressLine1}, ${job.postcode ?? ''}`.trim().replace(/, $/, '')
            : 'a property'
          const verb = body.status === 'resolved' ? 'resolved' : 'escalated'
          const title =
            body.status === 'resolved' ? 'Dispute resolved' : 'Dispute escalated'

          const rows = [
            {
              userId: job.clientId,
              type: 'job' as const,
              title,
              message: `Dispute for ${addr} ${verb}.${
                body.resolution ? ` ${body.resolution}` : ''
              }`,
              link: `/client/jobs/${job.id}`,
            },
          ]
          if (job.clerkId) {
            rows.push({
              userId: job.clerkId,
              type: 'job' as const,
              title,
              message: `Dispute for ${addr} ${verb}.${
                body.resolution ? ` ${body.resolution}` : ''
              }`,
              link: `/clerk/jobs/${job.id}`,
            })
          }
          await tx.insert(notifications).values(rows)
        }
      }

      return { status: 'ok' as const }
    })

    if (result.status === 'not_found') return notFound('Dispute not found')
    return ok({ success: true, noop: result.status === 'noop' })
  } catch (err) {
    console.error('[admin/disputes/resolve] error:', err)
    return errorResponse(err)
  }
}
