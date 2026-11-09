import { badRequest, errorResponse, ok } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import { BillingProviderNotImplementedError } from '@/lib/billing/provider'
import { getBillingProvider } from '@/lib/billing/select'

export const maxDuration = 60
export const runtime = 'nodejs'

type Params = Promise<{ id: string }>

/**
 * POST /api/billing/invoices/[id]/issue — locks the draft, allocates a
 * reference, snapshots the tax summary, renders the PDF, uploads it to
 * storage, and stamps `issued_at`. Writes a `billing/invoice.issued`
 * audit row inside the issue tx.
 *
 * Slow path (PDF render + storage upload) sits outside the tx so the
 * Postgres connection isn't held for the render duration.
 */
export async function POST(_req: Request, { params }: { params: Params }) {
  const session = await authorizeRequest('admin')
  if (session instanceof Response) return session

  try {
    const { id } = await params
    const provider = await getBillingProvider()
    const result = await provider.issueInvoice(id, session.userId)
    return ok({ success: true, ...result })
  } catch (err) {
    if (err instanceof BillingProviderNotImplementedError) {
      return badRequest(err.message)
    }
    console.error('[billing/invoices/issue] error:', err)
    return errorResponse(err)
  }
}
