import { badRequest, errorResponse, ok } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import {
  createClerkConnectOnboardingLink,
  isStripeConfigured,
} from '@/lib/billing/escrow'

export const runtime = 'nodejs'
export const maxDuration = 20

/**
 * POST /api/stripe/connect/onboard — start (or resume) the calling clerk's
 * Stripe Express onboarding. Returns a hosted account-link URL the client
 * redirects to; on return Stripe fires `account.updated` which syncs the
 * clerk's payout flags.
 */
export async function POST(_req: Request) {
  const session = await authorizeRequest('clerk', 'cleaner', 'admin')
  if (session instanceof Response) return session

  if (!isStripeConfigured()) {
    return badRequest('Payments are not configured on this server.')
  }

  // Cleaners return to their own settings surface so the `?stripe=done`
  // status sync renders there; everyone else lands on clerk settings.
  const returnPath =
    session.roles.includes('cleaner') && !session.roles.includes('clerk')
      ? '/cleaner/settings'
      : '/clerk/settings'

  try {
    const { url } = await createClerkConnectOnboardingLink(
      session.userId,
      returnPath
    )
    return ok({ url })
  } catch (err) {
    console.error('[stripe/connect/onboard] error:', err)
    return errorResponse(err)
  }
}
