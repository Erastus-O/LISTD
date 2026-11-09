import 'server-only'
import type Stripe from 'stripe'

/**
 * Server-side Stripe client singleton used by the inbuilt billing
 * provider (Phase 6 — pay-by-link). Stripe is only initialised when
 * `STRIPE_SECRET_KEY` is set; environments without Stripe configured
 * (e.g. local dev, preview deploys without secrets) fall back to a
 * helpful runtime error rather than blowing up on import.
 *
 * Webhook signature verification uses `STRIPE_WEBHOOK_SECRET`. Keep the
 * webhook secret separate from the publishable/secret API keys — Stripe
 * rotates them independently and the webhook secret is endpoint-scoped.
 *
 * **Lazy SDK load.** The `stripe` package is ~250 sub-packages and a
 * heavy module-init. We only `import` it inside `getStripe()` so callers
 * that just need `isStripeConfigured()` (e.g. client invoice detail
 * page deciding whether to render "Pay now") don't pay the bundle
 * cost. Saves ~30s of dev-mode cold-compile per touching page.
 */

let cached: Stripe | null = null

export async function getStripe(): Promise<Stripe> {
  if (cached) return cached
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) {
    throw new Error(
      'STRIPE_SECRET_KEY is not set. Configure it in env to enable pay-by-link.'
    )
  }
  const { default: Stripe } = await import('stripe')
  cached = new Stripe(key)
  return cached
}

export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY)
}

export function getWebhookSecret(): string {
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!secret) {
    throw new Error(
      'STRIPE_WEBHOOK_SECRET is not set. The /api/webhooks/stripe route cannot verify signatures.'
    )
  }
  return secret
}

/**
 * Every webhook signing secret this deploy should accept, parsed from
 * `STRIPE_WEBHOOK_SECRET` as a comma/whitespace-separated list.
 *
 * Stripe Connect (Accounts v2) routes platform events and connected-account
 * events to SEPARATE destinations, each with its own `whsec_…`. So a single
 * endpoint legitimately needs to verify against more than one secret. The
 * webhook route tries each until one validates. A single-secret value is the
 * common case and still works unchanged.
 */
export function getWebhookSecrets(): string[] {
  const raw = process.env.STRIPE_WEBHOOK_SECRET
  if (!raw) {
    throw new Error(
      'STRIPE_WEBHOOK_SECRET is not set. The /api/webhooks/stripe route cannot verify signatures.'
    )
  }
  return raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * The app's externally addressable origin, used to build Stripe
 * `success_url` / `cancel_url`. Falls back to a sane default for local
 * dev but the Vercel deploy must set NEXT_PUBLIC_SITE_URL so the
 * redirect lands on the right host.
 */
export function getSiteOrigin(): string {
  const env =
    process.env.NEXT_PUBLIC_SITE_URL ?? process.env.NEXT_PUBLIC_APP_URL
  if (env) return env.replace(/\/$/, '')
  return 'http://localhost:3000'
}
