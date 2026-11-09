import { errorResponse, notFound, ok } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import { withServiceRole } from '@/db'
import { canActOnClientJob } from '@/lib/listd/client-access'
import { approveJob } from '@/lib/listd/lifecycle'

export const runtime = 'nodejs'

type Params = Promise<{ jobId: string }>

/**
 * POST /api/client/jobs/[jobId]/approve: the client approves the finished job.
 * Payment becomes payable to the Pro in the next weekly payout.
 */
export async function POST(_req: Request, { params }: { params: Params }) {
  const session = await authorizeRequest('client', 'admin')
  if (session instanceof Response) return session
  try {
    const { jobId } = await params
    const result = await withServiceRole(async (tx) => {
      if (!(await canActOnClientJob(tx, session, jobId))) return { found: false as const }
      const mode = session.roles.includes('admin') ? ('admin' as const) : ('client' as const)
      return { found: true as const, r: await approveJob(tx, { jobId, mode, actorId: session.userId }) }
    })
    if (!result.found) return notFound('Job not found')
    if (!result.r.ok) return Response.json({ error: result.r.error, code: result.r.code }, { status: 409 })
    return ok({ success: true })
  } catch (err) {
    console.error('[client/approve] error:', err)
    return errorResponse(err)
  }
}
