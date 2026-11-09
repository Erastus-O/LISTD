import { z } from 'zod'
import { errorResponse, ok } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import { clientRebates, withServiceRole } from '@/db'
import { logAuditEvent } from '@/lib/audit'
import { getPricing } from '@/lib/listd/pricing-settings'
import { clientPortfolio } from '@/lib/listd/portfolio'

export const runtime = 'nodejs'

const Body = z.object({
  clientId: z.string().uuid(),
  month: z.string().regex(/^\d{4}-\d{2}$/),
  note: z.string().trim().max(500).optional(),
}).strict()

/** GET ?clientId&month: what's due. POST: record the rebate (once per client and month). */
export async function GET(req: Request) {
  const session = await authorizeRequest('admin')
  if (session instanceof Response) return session
  try {
    const q = Object.fromEntries(new URL(req.url).searchParams)
    const { clientId, month } = Body.pick({ clientId: true, month: true }).parse(q)
    const pr = await getPricing()
    const summary = await withServiceRole((tx) => clientPortfolio(tx, pr, clientId, month))
    return ok(summary)
  } catch (err) {
    return errorResponse(err)
  }
}

export async function POST(req: Request) {
  const session = await authorizeRequest('admin')
  if (session instanceof Response) return session
  try {
    const body = Body.parse(await req.json())
    const pr = await getPricing()
    const r = await withServiceRole(async (tx) => {
      const s = await clientPortfolio(tx, pr, body.clientId, body.month)
      if (s.rebateP <= 0) return { ok: false as const, error: 'No rebate is due for this month.' }
      if (s.recordedP > 0) return { ok: false as const, error: 'The rebate for this month is already recorded.' }
      await tx.insert(clientRebates).values({ clientId: body.clientId, month: body.month, amountP: s.rebateP, recordedBy: session.userId, note: body.note ?? null })
      await logAuditEvent(tx, {
        category: 'billing',
        action: 'rebate.recorded',
        actorUserId: session.userId,
        targetType: 'profile',
        targetId: body.clientId,
        payload: { month: body.month, amountP: s.rebateP },
      })
      return { ok: true as const, amountP: s.rebateP }
    })
    if (!r.ok) return Response.json({ error: r.error }, { status: 409 })
    return ok({ success: true, amountP: r.amountP })
  } catch (err) {
    console.error('[admin/rebates] error:', err)
    return errorResponse(err)
  }
}
