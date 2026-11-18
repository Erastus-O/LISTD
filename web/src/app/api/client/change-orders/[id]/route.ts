import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { errorResponse, forbidden, notFound, ok } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import { changeOrders, jobs, withServiceRole } from '@/db'
import { createEscrowCheckoutForJobs } from '@/lib/billing/escrow'
import { isStripeConfigured } from '@/lib/billing/stripe'
import { canActOnClientJob } from '@/lib/listd/client-access'
import { decideChangeOrder } from '@/lib/listd/quotes'

export const runtime = 'nodejs'

const Body = z.object({ approve: z.boolean() }).strict()
type Params = Promise<{ id: string }>

/**
 * POST /api/client/change-orders/[id]: approve or reject priced extra work.
 * Approving opens checkout for the difference when payments are on.
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
    if (!approve || !isStripeConfigured() || !r.totalP) return ok({ success: true })

    // The client pays the difference now: the extra work plus the change in
    // booking fee. It's held like the original payment and released to the
    // Pro (their extra net) when the job is approved.
    const [co] = await withServiceRole((tx) =>
      tx
        .select({ proFeeP: changeOrders.proFeeP, clientId: jobs.clientId, description: changeOrders.description })
        .from(changeOrders)
        .innerJoin(jobs, eq(jobs.id, changeOrders.jobId))
        .where(eq(changeOrders.id, id))
        .limit(1)
    )
    const checkout = await createEscrowCheckoutForJobs({
      clientUserId: co.clientId,
      items: [{ jobId: r.jobId, grossPounds: r.totalP / 100, clerkPounds: (co.proFeeP ?? 0) / 100, description: `LISTD extra work: ${co.description}` }],
    })
    await withServiceRole((tx) =>
      tx.update(changeOrders).set({ stripeCheckoutSessionId: checkout.sessionId }).where(eq(changeOrders.id, id))
    )
    return ok({ success: true, checkoutUrl: checkout.url })
  } catch (err) {
    console.error('[client/change-orders] error:', err)
    return errorResponse(err)
  }
}
