import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { errorResponse, forbidden, notFound, ok } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import { changeOrders, withServiceRole } from '@/db'
import { canActOnClientJob } from '@/lib/listd/client-access'
import { decideChangeOrder } from '@/lib/listd/quotes'

export const runtime = 'nodejs'

const Body = z.object({ approve: z.boolean() }).strict()
type Params = Promise<{ id: string }>

/**
 * POST /api/client/change-orders/[id]: approve or reject priced extra work.
 * Taking payment for approved work is the next step (see PORTING.md).
 */
export async function POST(req: Request, { params }: { params: Params }) {
  const session = await authorizeRequest('client', 'admin')
  if (session instanceof Response) return session
  try {
    const { id } = await params
    const { approve } = Body.parse(await req.json())
    const r = await withServiceRole(async (tx) => {
      const [co] = await tx.select({ jobId: changeOrders.jobId }).from(changeOrders).where(eq(changeOrders.id, id)).limit(1)
      if (!co) return 'missing' as const
      if (!(await canActOnClientJob(tx, session, co.jobId))) return 'forbidden' as const
      return decideChangeOrder(tx, { id, approve, actorId: session.userId })
    })
    if (r === 'missing') return notFound('Change order not found')
    if (r === 'forbidden') return forbidden('You can’t decide this change order.')
    if (!r.ok) return Response.json({ error: r.error }, { status: 409 })
    return ok({ success: true })
  } catch (err) {
    console.error('[client/change-orders] error:', err)
    return errorResponse(err)
  }
}
