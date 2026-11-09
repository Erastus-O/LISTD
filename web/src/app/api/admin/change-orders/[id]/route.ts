import { z } from 'zod'
import { errorResponse, ok } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import { withServiceRole } from '@/db'
import { getPricing } from '@/lib/listd/pricing-settings'
import { priceChangeOrder } from '@/lib/listd/quotes'
import { QuoteLineSchema } from '@/lib/listd/schemas'

export const runtime = 'nodejs'

const Body = z.object({ lines: z.array(QuoteLineSchema).min(1).max(50), proFeeP: z.number().int().min(0).optional() }).strict()
type Params = Promise<{ id: string }>

/** POST /api/admin/change-orders/[id]: LISTD prices extra work a Pro proposed. */
export async function POST(req: Request, { params }: { params: Params }) {
  const session = await authorizeRequest('admin')
  if (session instanceof Response) return session
  try {
    const { id } = await params
    const body = Body.parse(await req.json())
    const pr = await getPricing()
    const r = await withServiceRole((tx) => priceChangeOrder(tx, pr, { id, ...body, actorId: session.userId }))
    if (!r.ok) return Response.json({ error: r.error }, { status: 409 })
    return ok({ success: true, totalP: r.totalP, creditP: r.creditP })
  } catch (err) {
    console.error('[admin/change-orders] error:', err)
    return errorResponse(err)
  }
}
