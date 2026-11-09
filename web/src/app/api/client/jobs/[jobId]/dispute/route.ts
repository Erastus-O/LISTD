import { eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { errorResponse, notFound, ok } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import { disputes, jobs, withServiceRole } from '@/db'
import { logAuditEvent } from '@/lib/audit'
import { canActOnClientJob } from '@/lib/listd/client-access'
import { pauseReviewForDispute } from '@/lib/listd/lifecycle'

export const runtime = 'nodejs'

const Body = z.object({
  reason: z.string().trim().min(2).max(120),
  description: z.string().trim().min(3, 'Say what went wrong').max(4000),
}).strict()
type Params = Promise<{ jobId: string }>

/**
 * POST /api/client/jobs/[jobId]/dispute: raise a dispute. Stops the review clock
 * and freezes the payout until LISTD settles it. After payout it's still recorded
 * for LISTD to handle, but it doesn't reverse the payment.
 */
export async function POST(req: Request, { params }: { params: Params }) {
  const session = await authorizeRequest('client', 'admin')
  if (session instanceof Response) return session
  try {
    const { jobId } = await params
    const body = Body.parse(await req.json())
    const result = await withServiceRole(async (tx) => {
      if (!(await canActOnClientJob(tx, session, jobId))) return null
      const [job] = await tx
        .select({ clerkId: jobs.clerkId, cleanerId: jobs.cleanerId, clientId: jobs.clientId })
        .from(jobs)
        .where(eq(jobs.id, jobId))
        .limit(1)
      const against = job?.clerkId ?? job?.cleanerId
      if (!job || !against) return { ok: false as const, error: 'A dispute can be raised once a Pro has the job.' }
      const [row] = await tx
        .insert(disputes)
        .values({ jobId, raisedBy: session.userId, raisedAgainst: against, reason: body.reason, description: body.description })
        .returning({ id: disputes.id })
      await pauseReviewForDispute(tx, jobId)
      await tx.update(jobs).set({ updatedAt: sql`now()` }).where(eq(jobs.id, jobId))
      await logAuditEvent(tx, {
        category: 'dispute',
        action: 'dispute.raised',
        actorUserId: session.userId,
        targetType: 'dispute',
        targetId: row.id,
        payload: { jobId, reason: body.reason },
      })
      return { ok: true as const, id: row.id }
    })
    if (!result) return notFound('Job not found')
    if (!result.ok) return Response.json({ error: result.error }, { status: 409 })
    return ok({ success: true, disputeId: result.id })
  } catch (err) {
    console.error('[client/dispute] error:', err)
    return errorResponse(err)
  }
}
