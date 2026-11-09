import { z } from 'zod'
import {
  badRequest,
  created,
  errorResponse,
} from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import { BillingProviderNotImplementedError } from '@/lib/billing/provider'
import { getBillingProvider } from '@/lib/billing/select'

export const maxDuration = 30
export const runtime = 'nodejs'

type Params = { params: Promise<{ id: string }> }

const LineItemSchema = z.object({
  description: z.string().trim().min(1).max(500),
  quantity: z.number().positive().max(100_000).optional(),
  unitPrice: z.number().min(0).max(1_000_000),
  taxRateId: z.string().uuid().nullable().optional(),
  jobId: z.string().uuid().nullable().optional(),
  position: z.number().int().min(0).max(100).optional(),
})

const RequestSchema = z
  .object({
    reason: z.string().trim().min(3).max(500),
    notes: z.string().trim().max(2000).nullable().optional(),
    lineItems: z.array(LineItemSchema).min(1).max(60),
  })
  .strict()

/**
 * POST /api/billing/invoices/[id]/credit-notes — create a draft credit
 * note offsetting the parent invoice referenced in the URL.
 *
 * Phase 8 of the inbuilt invoice generator. Admin-only. The provider
 * may not implement credit notes (Xero stub does not yet) — in that
 * case we 400 with the BillingProviderNotImplementedError message so
 * the UI can show a friendly fallback rather than 500ing.
 */
export async function POST(req: Request, { params }: Params) {
  const session = await authorizeRequest('admin')
  if (session instanceof Response) return session

  try {
    const { id: parentInvoiceId } = await params
    const body = RequestSchema.parse(await req.json())
    const provider = await getBillingProvider()

    if (typeof provider.createCreditNote !== 'function') {
      return badRequest(
        `Billing provider '${provider.id}' does not support credit notes.`
      )
    }

    const result = await provider.createCreditNote(
      {
        parentInvoiceId,
        reason: body.reason,
        notes: body.notes ?? null,
        lineItems: body.lineItems,
      },
      session.userId
    )
    return created({ creditNote: result })
  } catch (err) {
    if (err instanceof BillingProviderNotImplementedError) {
      return badRequest(err.message)
    }
    console.error('[billing/invoices/:id/credit-notes] error:', err)
    return errorResponse(err)
  }
}
