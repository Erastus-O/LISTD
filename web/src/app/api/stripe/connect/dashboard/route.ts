import { badRequest, errorResponse, ok } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import {
  createClerkExpressLoginLink,
  isStripeConfigured,
} from '@/lib/billing/escrow'

export const runtime = 'nodejs'
export const maxDuration = 20

/**
 * POST /api/stripe/connect/dashboard — one-time login link into the calling
 * clerk's Stripe Express dashboard so they can update their bank account /
 * payout details or view payouts.
 */
export async function POST(_req: Request) {
  const session = await authorizeRequest('clerk', 'cleaner', 'admin')
  if (session instanceof Response) return session

  if (!isStripeConfigured()) {
    return badRequest('Payments are not configured on this server.')
  }

  try {
    const { url } = await createClerkExpressLoginLink(session.userId)
    return ok({ url })
  } catch (err) {
    console.error('[stripe/connect/dashboard] error:', err)
    return errorResponse(err)
  }
}
