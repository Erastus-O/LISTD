import { z } from 'zod'
import { errorResponse, ok } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import { withServiceRole } from '@/db'
import { getPricing } from '@/lib/listd/pricing-settings'
import { issueQuote } from '@/lib/listd/quotes'
import { QuoteLineSchema } from '@/lib/listd/schemas'

export const runtime = 'nodejs'

const Body = z.object({
  lines: z.array(QuoteLineSchema).min(1).max(50),
  proFeeP: z.number().int().min(0).optional(),
  durationMin: z.number().int().min(0).optional(),
  exclusions: z.string().trim().max(2000).optional(),
  why: z.string().trim().max(500).optional(),
  discP: z.number().int().min(0).optional(),
}).strict()

type Params = Promise<{ jobId: string }>

/** POST /api/admin/jobs/[jobId]/quote: issue a quote or a new version. */
export async function POST(req: Request, { params }: { params: Params }) {
  const session = await authorizeRequest('admin')
  if (session instanceof Response) return session
  try {
    const { jobId } = await params
    const body = Body.parse(await req.json())
    const pr = await getPricing()
    const result = await withServiceRole((tx) => issueQuote(tx, pr, { jobId, ...body, actorId: session.userId }))
    if (!result.ok) return Response.json({ error: result.error }, { status: 409 })
    return ok({ success: true, version: result.quote.version, totalP: result.quote.totalP })
  } catch (err) {
    console.error('[admin/quote] error:', err)
    return errorResponse(err)
  }
}
