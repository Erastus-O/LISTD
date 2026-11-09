import { eq } from 'drizzle-orm'
import {
  badRequest,
  errorResponse,
  forbidden,
  notFound,
  ok,
} from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import { db, invoices } from '@/db'
import { BillingProviderNotImplementedError } from '@/lib/billing/provider'
import { getBillingProvider } from '@/lib/billing/select'

export const maxDuration = 15
export const runtime = 'nodejs'

type Params = { params: Promise<{ id: string }> }

/**
 * POST /api/billing/invoices/[id]/payment-link — create a Stripe Checkout
 * session for the outstanding balance and return its hosted URL.
 *
 * Authorisation:
 *   - admin: always allowed
 *   - the invoice's `client_id`: allowed (they're the payer)
 *   - anyone else: 403
 *
 * If the active billing provider doesn't implement payment links (Xero
 * stub, or inbuilt with no STRIPE_SECRET_KEY), we 501 with a clear
 * message — the page handler should hide the "Pay now" button when this
 * happens rather than swallow the error silently.
 */
export async function POST(_req: Request, { params }: Params) {
  const session = await authorizeRequest('admin', 'client')
  if (session instanceof Response) return session

  try {
    const { id } = await params
    const [row] = await db
      .select({ id: invoices.id, clientId: invoices.clientId })
      .from(invoices)
      .where(eq(invoices.id, id))
      .limit(1)
    if (!row) return notFound('Invoice not found')

    const isAdmin = session.roles.includes('admin')
    const isOwner = row.clientId === session.userId
    if (!isAdmin && !isOwner) {
      return forbidden('You cannot pay this invoice.')
    }

    const provider = await getBillingProvider()
    if (typeof provider.createPaymentLink !== 'function') {
      return badRequest(
        `Billing provider '${provider.id}' does not support payment links.`
      )
    }

    const link = await provider.createPaymentLink(id, session.userId)
    return ok({ checkoutUrl: link.checkoutUrl, sessionId: link.sessionId })
  } catch (err) {
    if (err instanceof BillingProviderNotImplementedError) {
      return badRequest(err.message)
    }
    console.error('[billing/invoices/:id/payment-link] error:', err)
    return errorResponse(err)
  }
}
