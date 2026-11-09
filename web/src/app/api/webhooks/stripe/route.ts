import type Stripe from 'stripe'
import { errorResponse, ok, unauthorized } from '@/lib/api'
import { tryClaim } from '@/lib/cache'
import { logError, logPayment } from '@/lib/logging/logger'
import { getStripe, getWebhookSecrets } from '@/lib/billing/stripe'
import { getBillingProvider } from '@/lib/billing/select'
import {
  fulfilEscrowCheckout,
  recordEscrowChargeFromPI,
  updateClerkConnectFromAccount,
} from '@/lib/billing/escrow'

// Stripe retries failed webhook deliveries with exponential backoff for up
// to ~3 days. We claim each event.id for a slightly longer window so a
// retry mid-backoff still gets absorbed silently.
const STRIPE_IDEMPOTENCY_TTL_SECONDS = 60 * 60 * 24 * 4 // 4 days

export const maxDuration = 30
export const runtime = 'nodejs'

/**
 * POST /api/webhooks/stripe — Stripe event ingest. Currently handles:
 *
 *   - checkout.session.completed → records a payment idempotently against
 *     the matching invoice via `provider.recordPayment`. Idempotency is
 *     keyed on `stripeCheckoutSessionId`; retries from Stripe's at-least-
 *     once delivery are safe.
 *
 *   - charge.refunded (forward-compat — Phase 6.1) is acknowledged but
 *     not yet acted on; refunds need a UX decision (full void vs partial
 *     reversal) before they wire into invoice status transitions.
 *
 * Signature verification uses `STRIPE_WEBHOOK_SECRET` and the raw body
 * — Next.js gives us the Web Request, so we read with `await req.text()`
 * and reconstruct the event with Stripe's library helper.
 */
export async function POST(req: Request) {
  const signature = req.headers.get('stripe-signature')
  if (!signature) return unauthorized()

  let event: Stripe.Event
  try {
    const rawBody = await req.text()
    const stripe = await getStripe()
    // Connect splits platform events and connected-account events across two
    // destinations, each with its own signing secret. Try each configured
    // secret until one verifies; only fail if none do.
    const secrets = getWebhookSecrets()
    let verified: Stripe.Event | null = null
    let lastErr: unknown = null
    for (const secret of secrets) {
      try {
        verified = stripe.webhooks.constructEvent(rawBody, signature, secret)
        break
      } catch (err) {
        lastErr = err
      }
    }
    if (!verified) throw lastErr ?? new Error('No matching webhook secret')
    event = verified
  } catch (err) {
    console.warn('[webhooks/stripe] signature verification failed:', err)
    return unauthorized()
  }

  // Idempotency claim BEFORE dispatch — Stripe's "at-least-once" means we
  // can see the same event.id twice within the retry window. The DB-level
  // guards inside `recordPayment` are the safety net; this just stops us
  // wasting compute on the duplicate.
  const claimed = await tryClaim(
    `webhook:stripe:${event.id}`,
    STRIPE_IDEMPOTENCY_TTL_SECONDS
  )
  if (!claimed) {
    console.info('[webhooks/stripe] duplicate delivery dropped:', event.id)
    return ok({ received: true, duplicate: true })
  }

  await logPayment('webhook.received', event.type, {
    eventId: event.id,
    livemode: event.livemode,
  })

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        await handleCheckoutCompleted(event.data.object)
        break
      }
      case 'payment_intent.succeeded': {
        // Escrow safety net: make sure the held escrow has its charge id for
        // the eventual transfer. No-ops for non-escrow payment intents.
        const pi = event.data.object as Stripe.PaymentIntent
        const chargeId =
          typeof pi.latest_charge === 'string'
            ? pi.latest_charge
            : pi.latest_charge?.id ?? null
        await recordEscrowChargeFromPI(pi.id, chargeId)
        break
      }
      case 'account.updated': {
        // Clerk Stripe Connect onboarding progressed — sync their payout flags.
        await updateClerkConnectFromAccount(event.data.object as Stripe.Account)
        break
      }
      case 'charge.refunded': {
        console.info(
          '[webhooks/stripe] charge.refunded received but no action yet:',
          event.id
        )
        break
      }
      default: {
        // Unknown events are ack'd so Stripe stops retrying.
        console.info('[webhooks/stripe] unhandled event:', event.type)
      }
    }
    return ok({ received: true })
  } catch (err) {
    console.error('[webhooks/stripe] handler error:', err)
    await logError('webhook.handler_error', err, {
      eventType: event.type,
      eventId: event.id,
    })
    return errorResponse(err)
  }
}

async function handleCheckoutCompleted(
  session: Stripe.Checkout.Session
): Promise<void> {
  // Only "paid" sessions translate to a payment row. Sessions that
  // expire / fail land with payment_status='unpaid' and we ignore them.
  if (session.payment_status !== 'paid') {
    console.info(
      '[webhooks/stripe] checkout.session.completed but payment_status=',
      session.payment_status,
      'session=',
      session.id
    )
    return
  }

  // Escrow booking payment: hold the funds + publish the job. Distinct from
  // invoice pay-by-link (handled below) via `metadata.type`.
  if (session.metadata?.type === 'escrow') {
    const res = await fulfilEscrowCheckout(session)
    console.info(
      '[webhooks/stripe] escrow checkout fulfilled:',
      res?.jobId ?? 'no-op'
    )
    return
  }

  const invoiceId =
    session.metadata?.invoiceId ??
    session.client_reference_id ??
    null
  if (!invoiceId) {
    console.warn(
      '[webhooks/stripe] checkout.session.completed without invoiceId metadata',
      session.id
    )
    return
  }

  const amountTotalMinor = session.amount_total ?? 0
  const paidAmount = amountTotalMinor / 100
  if (paidAmount <= 0) {
    console.warn(
      '[webhooks/stripe] checkout.session.completed with non-positive amount',
      session.id
    )
    return
  }

  const paymentIntentId =
    typeof session.payment_intent === 'string'
      ? session.payment_intent
      : session.payment_intent?.id ?? null

  const provider = await getBillingProvider()
  // Prefer the original actor that started the checkout (set in
  // `metadata.actorUserId` by createPaymentLink) so the audit row carries
  // attribution; fall back to null = system actor.
  const actorUserId = session.metadata?.actorUserId || null
  await provider.recordPayment(invoiceId, actorUserId, {
    paidAmount,
    paidAt: new Date().toISOString().slice(0, 10),
    method: 'stripe',
    reference: session.id,
    stripeCheckoutSessionId: session.id,
    stripePaymentIntentId: paymentIntentId,
    note: 'Hosted Stripe Checkout',
  })
}
