import { z } from 'zod'
import { errorResponse, forbidden, ok } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import { withServiceRole } from '@/db'
import { channelAccess, loadThread, postMessage } from '@/lib/listd/job-messages'

export const runtime = 'nodejs'

const Channel = z.enum(['pro', 'client'])
const Body = z.object({ channel: Channel, body: z.string().trim().min(1).max(4000) }).strict()
type Params = Promise<{ jobId: string }>

/**
 * GET  /api/jobs/[jobId]/messages?channel=pro|client: the thread (marks it read).
 * POST /api/jobs/[jobId]/messages: send. Pros use 'pro', clients use 'client'
 * when client chat is on, LISTD uses either. Nobody can message across sides.
 */
export async function GET(req: Request, { params }: { params: Params }) {
  const session = await authorizeRequest('clerk', 'cleaner', 'trades', 'client', 'admin')
  if (session instanceof Response) return session
  try {
    const { jobId } = await params
    const channel = Channel.parse(new URL(req.url).searchParams.get('channel') ?? 'pro')
    const side = await withServiceRole((tx) => channelAccess(tx, session, jobId, channel))
    if (!side) return forbidden('You can’t see this conversation.')
    return ok({ messages: await loadThread(jobId, channel, side) })
  } catch (err) {
    return errorResponse(err)
  }
}

export async function POST(req: Request, { params }: { params: Params }) {
  const session = await authorizeRequest('clerk', 'cleaner', 'trades', 'client', 'admin')
  if (session instanceof Response) return session
  try {
    const { jobId } = await params
    const body = Body.parse(await req.json())
    const id = await withServiceRole(async (tx) => {
      const side = await channelAccess(tx, session, jobId, body.channel)
      if (!side) return null
      return postMessage(tx, { jobId, channel: body.channel, senderId: session.userId, side, body: body.body })
    })
    if (!id) return forbidden('You can’t message on this job.')
    return ok({ success: true, id })
  } catch (err) {
    console.error('[jobs/messages] error:', err)
    return errorResponse(err)
  }
}
