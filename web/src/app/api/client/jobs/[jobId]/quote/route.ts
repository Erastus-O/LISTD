import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { errorResponse, notFound, ok } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import { jobs, withServiceRole } from '@/db'
import { createEscrowCheckoutForJob, isStripeConfigured } from '@/lib/billing/escrow'
import { canActOnClientJob } from '@/lib/listd/client-access'
import { acceptQuote, declineQuote } from '@/lib/listd/quotes'

export const runtime = 'nodejs'

const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('accept') }),
  z.object({ action: z.literal('decline'), reason: z.string().trim().max(500).optional() }),
])
type Params = Promise<{ jobId: string }>

/**
 * POST /api/client/jobs/[jobId]/quote: accept (then pay) or decline a quote.
 * Nothing is charged until the client pays at checkout.
 */
export async function POST(req: Request, { params }: { params: Params }) {
  const session = await authorizeRequest('client', 'admin')
  if (session instanceof Response) return session
  try {
    const { jobId } = await params
    const body = Body.parse(await req.json())
    const result = await withServiceRole(async (tx) => {
      if (!(await canActOnClientJob(tx, session, jobId))) return null
      if (body.action === 'decline') {
        return { ...(await declineQuote(tx, { jobId, actorId: session.userId, reason: body.reason })), quote: null, job: null }
      }
      const r = await acceptQuote(tx, { jobId, actorId: session.userId })
      if (!r.ok) return { ...r, quote: null, job: null }
      const [job] = await tx
        .select({ clientId: jobs.clientId, clerkPayout: jobs.clerkPayout, cleanerPayout: jobs.cleanerPayout, inspectionType: jobs.inspectionType })
        .from(jobs)
        .where(eq(jobs.id, jobId))
        .limit(1)
      return { ...r, job }
    })
    if (!result) return notFound('Job not found')
    if (!result.ok) return Response.json({ error: result.error }, { status: 409 })
    if (body.action === 'decline') return ok({ success: true })

    if (!isStripeConfigured()) {
      // No payments configured (e.g. local): publish straight away.
      await withServiceRole((tx) => tx.update(jobs).set({ status: 'published' }).where(eq(jobs.id, jobId)))
      return ok({ success: true })
    }
    const { quote, job } = result
    const clerkP = quote!.proFeeP ?? Math.round(Number(job!.clerkPayout ?? job!.cleanerPayout ?? 0) * 100)
    const checkout = await createEscrowCheckoutForJob({
      jobId,
      clientUserId: job!.clientId,
      grossPounds: quote!.totalP / 100,
      clerkPounds: clerkP / 100,
      description: `LISTD booking ${jobId.slice(0, 8)}`,
    })
    return ok({ success: true, checkoutUrl: checkout.url })
  } catch (err) {
    console.error('[client/quote] error:', err)
    return errorResponse(err)
  }
}
