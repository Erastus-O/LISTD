import { z } from 'zod'
import { badRequest, errorResponse, ok } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import { BillingProviderNotImplementedError } from '@/lib/billing/provider'
import { getBillingProvider } from '@/lib/billing/select'

export const maxDuration = 30
export const runtime = 'nodejs'

const RequestSchema = z
  .object({
    /** Optional override list. Defaults to the invoice's `client_id`
     *  email when not provided. */
    recipients: z.array(z.string().trim().email()).max(20).optional(),
  })
  .strict()

type Params = Promise<{ id: string }>

/**
 * POST /api/billing/invoices/[id]/send — email the issued invoice PDF
 * to the recipient(s). Re-sending is allowed (idempotent on the audit
 * trail; each call writes its own `billing/invoice.sent` row).
 */
export async function POST(req: Request, { params }: { params: Params }) {
  const session = await authorizeRequest('admin')
  if (session instanceof Response) return session

  try {
    const { id } = await params
    const body = RequestSchema.parse(await req.json().catch(() => ({})))
    const provider = await getBillingProvider()
    await provider.sendInvoiceEmail(id, session.userId, body.recipients)
    return ok({ success: true })
  } catch (err) {
    if (err instanceof BillingProviderNotImplementedError) {
      return badRequest(err.message)
    }
    console.error('[billing/invoices/send] error:', err)
    return errorResponse(err)
  }
}
