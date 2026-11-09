import 'server-only'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db, platformSettings } from '@/db'
import { bust, getOrSet } from '@/lib/cache'
import {
  DEFAULT_PRICING,
  PROPERTY_SIZES,
  type CleaningPricing,
  type ClerkAddons,
  type ClientAddons,
  type CustomServiceType,
  type FurnishedMatrix,
  type Furnishing,
  type PricingMatrices,
} from './pricing-matrix'

/**
 * Runtime-editable pricing. The code {@link DEFAULT_PRICING} is the baseline;
 * an admin can override the full rate card from `/admin/pricing`, persisted as
 * a single JSON document in `platform_settings` under {@link PRICING_SETTINGS_KEY}.
 *
 * Reads go through a short Upstash cache (busted on save). If the stored value
 * is missing or fails validation we fall back to the code defaults, so a bad
 * row can never take pricing down.
 */

export const PRICING_SETTINGS_KEY = 'pricing_matrices'
const CACHE_KEY = 'pricing:matrices'
const CACHE_TTL_SECONDS = 300

const SIZE_COUNT = PROPERTY_SIZES.length

const row = z.array(z.number().int().min(0).max(100_000)).length(SIZE_COUNT)
const tierBlock = z.object({ flex: row, core: row, priority: row })
const furnishedBlock: z.ZodType<Record<Furnishing, FurnishedMatrix>> = z.object({
  unfurnished: tierBlock,
  furnished: tierBlock,
})
const rate = z.number().min(0).max(100_000)
const addonsSchema: z.ZodType<ClerkAddons> = z.object({
  checkInStandalone: rate,
  interim: rate,
  additionalKitchen: rate,
  additionalBathroom: rate,
  communalLounge: rate,
  hallwaysStairs: rate,
  utilityStorage: rate,
  gardenOutdoor: rate,
  heavilyFurnished: rate,
  abortedVisitPct: z.number().min(0).max(100),
})

const freeCount = z.number().int().min(0).max(50)
const clientAddonsSchema: z.ZodType<ClientAddons> = z.object({
  furnishingPartFurnished: rate,
  furnishingFurnished: rate,
  perBedroom: rate,
  perBathroom: rate,
  perLivingRoom: rate,
  perDiningArea: rate,
  perKitchen: rate,
  perGarden: rate,
  perCommunal: rate,
  perHallwaysStairs: rate,
  perUtilityRoom: rate,
  perStorageRoom: rate,
  freeBedrooms: freeCount,
  freeBathrooms: freeCount,
  freeLivingRooms: freeCount,
  freeDiningAreas: freeCount,
  freeKitchens: freeCount,
  freeGardens: freeCount,
  freeCommunal: freeCount,
  freeHallwaysStairs: freeCount,
  freeUtilityRooms: freeCount,
  freeStorageRooms: freeCount,
})

// Cleaning: client flat-£ rows (one per level) + cleaner {rate, maxHours} rows.
const cleanerBandRow = z
  .array(
    z.object({
      hourlyRate: rate,
      maxHours: z.number().min(0).max(24),
    })
  )
  .length(SIZE_COUNT)
const customCleanLevelSchema = z.object({
  key: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .regex(/^[a-z0-9_]+$/, 'lowercase letters, numbers and underscores only'),
  label: z.string().trim().min(1).max(80),
  enabled: z.boolean(),
  client: row,
  hourlyRate: z.number().min(0).max(1000),
  maxHours: z.array(z.number().min(0).max(100)).length(SIZE_COUNT),
  scope: z.string().max(500),
  tasks: z.array(z.string().min(1).max(300)).max(50),
})
const cleaningSchema: z.ZodType<CleaningPricing> = z.object({
  client: z.object({ light: row, general: row, deep: row }),
  cleaner: z.object({
    light: cleanerBandRow,
    general: cleanerBandRow,
    deep: cleanerBandRow,
  }),
  custom: z.array(customCleanLevelSchema).max(20).optional(),
  // Cleaning-specific replica of the client add-ons card. Optional so
  // stored rate cards saved before it existed still validate.
  clientAddons: clientAddonsSchema.optional(),
})

const fixed = z.number().min(0).max(100_000)
const customTypeSchema = z.object({
  key: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .regex(/^[a-z0-9_]+$/, 'lowercase letters, numbers and underscores only'),
  label: z.string().trim().min(1).max(120),
  baseModel: z.enum(['inventory', 'checkout', 'flat_size', 'flat_fixed']),
  requiresTenant: z.boolean(),
  showInBooking: z.boolean(),
  enabled: z.boolean(),
  signoffBy: z.enum(['client', 'tenant']).optional(),
  clientAcknowledgementRequired: z.boolean().optional(),
  clientMatrix: furnishedBlock.optional(),
  clerkMatrix: furnishedBlock.optional(),
  clientFlat: row.optional(),
  clerkFlat: row.optional(),
  clientFixed: fixed.optional(),
  clerkFixed: fixed.optional(),
})
const customTypesSchema: z.ZodType<CustomServiceType[]> = z
  .array(customTypeSchema)
  .max(50)

/** Validates a complete rate card (client + clerk pay + add-ons + custom types). */
export const PricingMatricesSchema: z.ZodType<PricingMatrices> = z.object({
  inventory: furnishedBlock,
  checkout: furnishedBlock,
  checkin: row,
  midterm: row,
  inventoryClerk: furnishedBlock,
  checkoutClerk: furnishedBlock,
  addons: addonsSchema,
  clientAddons: clientAddonsSchema,
  cleaning: cleaningSchema,
  customTypes: customTypesSchema,
})

/** Take a stored section if it validates, else the code default. */
function pick<T>(schema: z.ZodType<T>, value: unknown, fallback: T): T {
  const parsed = schema.safeParse(value)
  return parsed.success ? parsed.data : fallback
}

/**
 * The effective rate card: admin overrides merged over the code defaults,
 * per section — so a partial or legacy stored value (e.g. client-only, before
 * clerk pay existed) keeps what's valid and fills the rest from defaults.
 * Cached; falls back entirely to {@link DEFAULT_PRICING} on any read error.
 */
export async function getEffectivePricing(): Promise<PricingMatrices> {
  return getOrSet(CACHE_KEY, CACHE_TTL_SECONDS, async () => {
    try {
      const [settingRow] = await db
        .select({ value: platformSettings.value })
        .from(platformSettings)
        .where(eq(platformSettings.key, PRICING_SETTINGS_KEY))
        .limit(1)
      if (!settingRow?.value) return DEFAULT_PRICING
      const stored = JSON.parse(settingRow.value) as Record<string, unknown>
      return {
        inventory: pick(furnishedBlock, stored.inventory, DEFAULT_PRICING.inventory),
        checkout: pick(furnishedBlock, stored.checkout, DEFAULT_PRICING.checkout),
        checkin: pick(row, stored.checkin, DEFAULT_PRICING.checkin),
        midterm: pick(row, stored.midterm, DEFAULT_PRICING.midterm),
        inventoryClerk: pick(furnishedBlock, stored.inventoryClerk, DEFAULT_PRICING.inventoryClerk),
        checkoutClerk: pick(furnishedBlock, stored.checkoutClerk, DEFAULT_PRICING.checkoutClerk),
        addons: pick(addonsSchema, stored.addons, DEFAULT_PRICING.addons),
        clientAddons: pick(
          clientAddonsSchema,
          stored.clientAddons,
          DEFAULT_PRICING.clientAddons
        ),
        cleaning: pick(cleaningSchema, stored.cleaning, DEFAULT_PRICING.cleaning),
        customTypes: pick(customTypesSchema, stored.customTypes, DEFAULT_PRICING.customTypes),
      }
    } catch {
      // Malformed JSON / DB hiccup — never let pricing fail closed.
      return DEFAULT_PRICING
    }
  })
}

/** Invalidate the cached rate card (call right after a save). */
export async function bustEffectivePricing(): Promise<void> {
  await bust(CACHE_KEY)
}
