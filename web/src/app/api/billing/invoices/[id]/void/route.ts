import { z } from 'zod'
import { badRequest, errorResponse, ok } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import { BillingProviderNotImplementedError } from '@/lib/billing/provider'
import { getBillingProvider } from '@/lib/billing/select'

export const maxDuration = 15
export const runtime = 'nodejs'

const RequestSchema = z
  .object({
    /** Free-text reason. Required: voided invoices keep their number per
     *  HMRC; the reason has to live somewhere auditable. */
    reason: z.string().trim().min(3).max(500),
  })
  .strict()

type Params = Promise<{ id: string }>

/**
 * POST /api/billing/invoices/[id]/void — admin voids the invoice with a
 * required reason. Flips status to `void`, stamps `voided_at`, writes a
 * `billing/invoice.voided` audit row. Idempotent on already-void.
 */
export async function POST(req: Request, { params }: { params: Params }) {
  const session = await authorizeRequest('admin')
  if (session instanceof Response) return session

  try {
    const { id } = await params
    const body = RequestSchema.parse(await req.json())
    const provider = await getBillingProvider()
    await provider.voidInvoice(id, session.userId, body.reason)
    return ok({ success: true })
  } catch (err) {
    if (err instanceof BillingProviderNotImplementedError) {
      return badRequest(err.message)
    }
    console.error('[billing/invoices/void] error:', err)
    return errorResponse(err)
  }
}
