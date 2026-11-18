import { z } from 'zod'
import { errorResponse, ok } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import { withServiceRole } from '@/db'
import { approveInTx, declineAcceptInTx, runApprovalEffects } from '@/lib/listd/job-approval'

export const runtime = 'nodejs'

const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('approve') }),
  z.object({ action: z.literal('decline'), reason: z.string().trim().min(3).max(500) }),
])
type Params = Promise<{ jobId: string }>

/**
 * POST /api/admin/jobs/[jobId]/approval: LISTD approves a Pro's accept (details
 * unlock, brief sent) or declines it (job back on the board, Pro told why).
 */
export async function POST(req: Request, { params }: { params: Params }) {
  const session = await authorizeRequest('admin')
  if (session instanceof Response) return session
  try {
    const { jobId } = await params
    const body = Body.parse(await req.json())
    if (body.action === 'approve') {
      const effects = await withServiceRole((tx) => approveInTx(tx, { jobId, actorId: session.userId, mode: 'manual' }))
      if (!effects) return Response.json({ error: 'This job is not waiting for approval.' }, { status: 409 })
      await runApprovalEffects(effects, session.userId)
      return ok({ success: true })
    }
    const r = await withServiceRole((tx) => declineAcceptInTx(tx, { jobId, actorId: session.userId, reason: body.reason }))
    if (!r.ok) return Response.json({ error: r.error }, { status: 409 })
    return ok({ success: true })
  } catch (err) {
    console.error('[admin/jobs/approval] error:', err)
    return errorResponse(err)
  }
}
