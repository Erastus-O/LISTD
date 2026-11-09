import { ok } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import { getSiteOrigin, getStripe } from '@/lib/billing/stripe'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 15

/**
 * GET /api/health/stripe — admin-only sanity check for the Stripe env on this
 * deploy. Confirms the secret + webhook-signing secret are present, which
 * mode (test/live) the key is, that the API key actually works, and whether
 * Connect is reachable (so escrow payouts can run). Never returns secret
 * values — only booleans + the key's mode prefix.
 *
 * Use it after wiring Vercel env + the webhook destination to verify the
 * deploy without running a full booking.
 */
export async function GET() {
  const session = await authorizeRequest('admin')
  if (session instanceof Response) return session

  const secretKey = process.env.STRIPE_SECRET_KEY ?? ''
  const webhookSecretRaw = process.env.STRIPE_WEBHOOK_SECRET ?? ''
  const webhookSecrets = webhookSecretRaw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean)
  const keyMode = secretKey.startsWith('sk_live_')
    ? 'live'
    : secretKey.startsWith('sk_test_')
      ? 'test'
      : secretKey
        ? 'unknown'
        : 'missing'

  // Connect needs TWO destinations (platform + connected) → two whsec_ values
  // in STRIPE_WEBHOOK_SECRET (comma-separated). Flag if fewer than two or any
  // has a bad prefix.
  const allWhsec =
    webhookSecrets.length > 0 &&
    webhookSecrets.every((s) => s.startsWith('whsec_'))
  const webhookSecretMode =
    webhookSecrets.length === 0
      ? 'missing'
      : !allWhsec
        ? 'unexpected_prefix'
        : webhookSecrets.length < 2
          ? 'ok_single'
          : 'ok'

  const checks: {
    secretKeyPresent: boolean
    keyMode: string
    webhookSecretCount: number
    webhookSecretMode: string
    siteUrl: string
    apiReachable: boolean
    connectEnabled: boolean
    connectedAccounts: number | null
    error: string | null
  } = {
    secretKeyPresent: Boolean(secretKey),
    keyMode,
    webhookSecretCount: webhookSecrets.length,
    webhookSecretMode,
    siteUrl: getSiteOrigin(),
    apiReachable: false,
    connectEnabled: false,
    connectedAccounts: null,
    error: null,
  }

  if (checks.secretKeyPresent) {
    try {
      const stripe = await getStripe()
      // Cheap call that proves the key works.
      await stripe.balance.retrieve()
      checks.apiReachable = true
      // Listing connected accounts proves Connect is enabled on the platform.
      try {
        const accounts = await stripe.accounts.list({ limit: 1 })
        checks.connectEnabled = true
        // total_count isn't returned by default; presence of the list is enough
        // to confirm Connect. Report how many we saw in this page (0 or 1).
        checks.connectedAccounts = accounts.data.length
      } catch (connectErr) {
        checks.connectEnabled = false
        checks.error =
          connectErr instanceof Error ? connectErr.message : 'connect_failed'
      }
    } catch (apiErr) {
      checks.error = apiErr instanceof Error ? apiErr.message : 'api_failed'
    }
  }

  const allGood =
    checks.secretKeyPresent &&
    (checks.webhookSecretMode === 'ok' ||
      checks.webhookSecretMode === 'ok_single') &&
    checks.apiReachable &&
    checks.connectEnabled

  // For Connect escrow you really want BOTH destinations' secrets present.
  const connectWebhookReady = checks.webhookSecretMode === 'ok'

  return ok({ ok: allGood, connectWebhookReady, checks })
}
