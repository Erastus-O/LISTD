import { z } from 'zod'
import { errorResponse, ok } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import { withServiceRole } from '@/db'
import { proposeChangeOrder } from '@/lib/listd/quotes'

export const runtime = 'nodejs'

const Body = z.object({
  jobId: z.string().uuid(),
  description: z.string().trim().min(3).max(2000),
  estimateP: z.number().int().min(0).optional(),
}).strict()

/** POST /api/pro/change-orders: propose extra work on an active job. */
export async function POST(req: Request) {
  const session = await authorizeRequest('clerk', 'trades', 'cleaner')
  if (session instanceof Response) return session
  try {
    const body = Body.parse(await req.json())
    const r = await withServiceRole((tx) => proposeChangeOrder(tx, { ...body, proId: session.userId }))
    if (!r.ok) return Response.json({ error: r.error }, { status: 409 })
    return ok({ success: true, id: r.id })
  } catch (err) {
    console.error('[pro/change-orders] error:', err)
    return errorResponse(err)
  }
}
