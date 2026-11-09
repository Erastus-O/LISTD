import 'server-only'
import { eq, sql } from 'drizzle-orm'
import { platformSettings, withServiceRole } from '@/db'
import { mergePricing, type Pricing } from './pricing'

/**
 * Rate card overrides, edited on Admin › Pricing and merged over the defaults
 * in pricing.ts. Kept under its own key: the old matrices stay readable under
 * `pricing_matrices` until the old app is retired.
 */
export const PRICING_V2_KEY = 'pricing_v2'

export async function getPricing(): Promise<Pricing> {
  const [row] = await withServiceRole((tx) =>
    tx
      .select({ value: platformSettings.value })
      .from(platformSettings)
      .where(eq(platformSettings.key, PRICING_V2_KEY))
      .limit(1)
  )
  if (!row?.value) return mergePricing(null)
  try {
    return mergePricing(JSON.parse(row.value))
  } catch (err) {
    // A bad override must never break booking; fall back to the rate card.
    console.error('[pricing] invalid pricing_v2 setting, using defaults:', err)
    return mergePricing(null)
  }
}

export async function savePricingOverrides(overrides: Record<string, unknown>): Promise<void> {
  const value = JSON.stringify(overrides)
  await withServiceRole((tx) =>
    tx
      .insert(platformSettings)
      .values({ key: PRICING_V2_KEY, value })
      .onConflictDoUpdate({ target: platformSettings.key, set: { value, updatedAt: sql`now()` } })
  )
}
