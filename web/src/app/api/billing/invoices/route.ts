import { z } from 'zod'
import {
  badRequest,
  created,
  errorResponse,
} from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import {
  BillingProviderNotImplementedError,
} from '@/lib/billing/provider'
import { getBillingProvider } from '@/lib/billing/select'

export const maxDuration = 30
export const runtime = 'nodejs'

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
    clientId: z.string().uuid(),
    organisationId: z.string().uuid().nullable().optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
    lineItems: z.array(LineItemSchema).min(1).max(60),
  })
  .strict()

/**
 * POST /api/billing/invoices — admin creates a draft invoice.
 *
 * Routes through the active billing provider selected by
 * `platform_settings.invoice_provider`. When the provider hasn't shipped
 * the method yet (e.g. Xero in v1) we 501 the request with a clear
 * message rather than 500ing.
 */
export async function POST(req: Request) {
  const session = await authorizeRequest('admin')
  if (session instanceof Response) return session

  try {
    const body = RequestSchema.parse(await req.json())
    const provider = await getBillingProvider()
    const result = await provider.createInvoice(
      {
        clientId: body.clientId,
        organisationId: body.organisationId ?? null,
        notes: body.notes ?? null,
        lineItems: body.lineItems,
      },
      session.userId
    )
    return created({ invoice: result })
  } catch (err) {
    if (err instanceof BillingProviderNotImplementedError) {
      return badRequest(err.message)
    }
    console.error('[billing/invoices] error:', err)
    return errorResponse(err)
  }
}
