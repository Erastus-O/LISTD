import 'server-only'
import { eq } from 'drizzle-orm'
import { db, platformSettings } from '@/db'
import type { BillingProvider, BillingProviderId } from './provider'

const PROVIDER_SETTING_KEY = 'invoice_provider'
const DEFAULT_PROVIDER: BillingProviderId = 'inbuilt'

/**
 * Resolve the active billing provider for this request.
 *
 * Reads `platform_settings.invoice_provider` once per call — the setting
 * is admin-toggled rarely and the row is small, so we don't bother
 * caching. The handful of provider-touching routes can call this once at
 * the start of their handler.
 *
 * Falls back to the inbuilt provider when the setting is missing or
 * carries an unrecognised value. Returning *something* is preferable to
 * 500ing — admins can fix the setting from `/admin/settings/billing`.
 *
 * **Lazy provider import.** The inbuilt provider drags in the Stripe SDK,
 * pdf-lib, and Resend at module-init time. Page handlers that only need
 * `loadBillingProviderId()` (e.g. the provider-toggle settings page or
 * the recipient invoice list deciding whether to show "Pay now") would
 * otherwise pay the full bundle cost on cold dev compiles — measured at
 * ~50s on /admin/settings/billing before this seam. Lazy-loading keeps
 * that bundle scoped to mutating handlers that actually need it.
 *
 * See Docs/LISTD_Invoice_Generator_Plan.md §2.
 */
export async function getBillingProvider(): Promise<BillingProvider> {
  const id = await loadBillingProviderId()
  if (id === 'xero') {
    const { xeroBillingProvider } = await import('./xero/provider')
    return xeroBillingProvider
  }
  const { inbuiltBillingProvider } = await import('./inbuilt/provider')
  return inbuiltBillingProvider
}

/**
 * Lower-level helper that returns just the active provider id. Useful
 * for surfaces that need to render provider-aware copy (e.g. "You're
 * viewing inbuilt invoices") without actually invoking the provider.
 */
export async function loadBillingProviderId(): Promise<BillingProviderId> {
  try {
    const [row] = await db
      .select({ value: platformSettings.value })
      .from(platformSettings)
      .where(eq(platformSettings.key, PROVIDER_SETTING_KEY))
      .limit(1)
    const raw = row?.value?.trim()
    if (raw === 'xero' || raw === 'inbuilt') return raw
  } catch (err) {
    console.warn(
      '[billing/select] platform_settings lookup failed, defaulting to inbuilt:',
      err
    )
  }
  return DEFAULT_PROVIDER
}
