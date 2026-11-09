import { z } from 'zod'
import { badRequest, errorResponse, ok } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import { BillingProviderNotImplementedError } from '@/lib/billing/provider'
import { getBillingProvider } from '@/lib/billing/select'

export const maxDuration = 15
export const runtime = 'nodejs'

const RequestSchema = z
  .object({
    paidAmount: z.number().positive().max(10_000_000),
    paidAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    method: z
      .enum(['bank_transfer', 'card', 'cash', 'stripe', 'other'])
      .optional(),
    reference: z.string().trim().max(200).nullable().optional(),
    note: z.string().trim().max(2000).nullable().optional(),
  })
  .strict()

type Params = Promise<{ id: string }>

/**
 * POST /api/billing/invoices/[id]/payments — admin records a payment
 * against an issued/sent/overdue invoice. Flips status to `paid` when
 * the running paid_total catches up with the invoice total.
 *
 * Stripe webhook payments use the same provider method server-to-server
 * and pass `method: 'stripe' + stripeCheckoutSessionId` for idempotency
 * (see Phase 6, Docs/LISTD_Invoice_Generator_Plan.md §13).
 */
export async function POST(req: Request, { params }: { params: Params }) {
  const session = await authorizeRequest('admin')
  if (session instanceof Response) return session

  try {
    const { id } = await params
    const body = RequestSchema.parse(await req.json())
    const provider = await getBillingProvider()
    await provider.recordPayment(id, session.userId, {
      paidAmount: body.paidAmount,
      paidAt: body.paidAt,
      method: body.method,
      reference: body.reference ?? null,
      note: body.note ?? null,
    })
    return ok({ success: true })
  } catch (err) {
    if (err instanceof BillingProviderNotImplementedError) {
      return badRequest(err.message)
    }
    console.error('[billing/invoices/payments] error:', err)
    return errorResponse(err)
  }
}
