import { z } from 'zod'
import { errorResponse, notFound, ok } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import { withServiceRole } from '@/db'
import { canActOnClientJob } from '@/lib/listd/client-access'
import { requestCorrection } from '@/lib/listd/lifecycle'

export const runtime = 'nodejs'

const Body = z.object({ text: z.string().trim().min(3, 'Say what needs correcting').max(2000) }).strict()
type Params = Promise<{ jobId: string }>

/** POST /api/client/jobs/[jobId]/request-correction: send the job back to the Pro. */
export async function POST(req: Request, { params }: { params: Params }) {
  const session = await authorizeRequest('client', 'admin')
  if (session instanceof Response) return session
  try {
    const { jobId } = await params
    const { text } = Body.parse(await req.json())
    const result = await withServiceRole(async (tx) => {
      if (!(await canActOnClientJob(tx, session, jobId))) return null
      return requestCorrection(tx, { jobId, actorId: session.userId, text })
    })
    if (!result) return notFound('Job not found')
    if (!result.ok) return Response.json({ error: result.error }, { status: 409 })
    return ok({ success: true })
  } catch (err) {
    console.error('[client/request-correction] error:', err)
    return errorResponse(err)
  }
}
