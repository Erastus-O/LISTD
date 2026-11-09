/**
 * Master pricing matrices — single source of truth for client-facing prices.
 *
 * Format: index 0..9 maps to [studio, 1bed, 2bed, 3bed, 4bed, 5bed, 6bed,
 * 7bed, 8bed, 9bed]. All values are in GBP, no decimals.
 *
 * Source: ../../listd_master_rate_card.pdf §1 (Inventory & Condition) and §2
 * (Checkout). Regression-locked by `pricing-matrix.test.ts`.
 *
 * The full booking-flow pricing helpers (add-ons, urgency surcharges, bundle
 * discounts) port over from `src/utils/pricing.ts` in the Lovable repo when
 * the post-job 7-step flow is wired to real components — currently those
 * routes are placeholders. M0 ships only the matrices to lock the canonical
 * values + the test that pins them.
 */

export type ServiceTier = 'flex' | 'core' | 'priority'
export type Furnishing = 'unfurnished' | 'furnished'

export const PROPERTY_SIZES = [
  'studio',
  '1_bed',
  '2_bed',
  '3_bed',
  '4_bed',
  '5_bed',
  '6_bed',
  '7_bed',
  '8_bed',
  '9_bed',
] as const

export type PropertySize = (typeof PROPERTY_SIZES)[number]

export const INVENTORY_CLIENT_PRICING: Record<
  Furnishing,
  Record<ServiceTier, number[]>
> = {
  unfurnished: {
    flex:     [ 60,  70,  85, 100, 120, 135, 150, 170, 185, 200],
    core:     [ 70,  90, 110, 130, 150, 170, 190, 210, 230, 250],
    priority: [ 90, 110, 130, 150, 170, 190, 220, 240, 260, 280],
  },
  furnished: {
    flex:     [ 70,  80,  95, 115, 140, 155, 170, 190, 205, 220],
    core:     [ 80, 100, 125, 145, 170, 190, 210, 230, 250, 270],
    priority: [100, 120, 145, 165, 190, 210, 240, 260, 280, 300],
  },
}

export const CHECKOUT_CLIENT_PRICING: Record<
  Furnishing,
  Record<ServiceTier, number[]>
> = {
  unfurnished: {
    flex:     [ 50,  60,  75,  90, 115, 130, 165, 175, 185, 195],
    core:     [ 60,  80, 100, 120, 140, 160, 180, 200, 230, 250],
    priority: [ 80, 100, 120, 140, 160, 180, 200, 230, 260, 280],
  },
  furnished: {
    flex:     [ 60,  70,  85, 105, 135, 150, 180, 200, 230, 250],
    core:     [ 70,  90, 115, 135, 155, 180, 200, 220, 250, 270],
    priority: [ 90, 110, 135, 155, 175, 200, 220, 250, 280, 300],
  },
}

/**
 * Clerk pay (payout) matrices — what the clerk earns. Mirror of the client
 * matrices' shape. Source: `Docs/business/MAIN LISTD MASTER RATE CARD.pdf`
 * §1/§2 "Clerk Pay" column. Regression-locked by `pricing-matrix.test.ts`.
 */
export const INVENTORY_CLERK_PAY: Record<Furnishing, Record<ServiceTier, number[]>> = {
  unfurnished: {
    flex:     [22, 28, 35, 40, 45, 50, 56, 65, 72, 80],
    core:     [25, 32, 38, 42, 48, 54, 60, 68, 75, 85],
    priority: [28, 35, 40, 45, 50, 56, 65, 74, 80, 90],
  },
  furnished: {
    flex:     [25, 32, 38, 42, 48, 54, 60, 68, 75, 85],
    core:     [28, 35, 40, 45, 50, 56, 65, 72, 80, 90],
    priority: [32, 38, 42, 48, 52, 60, 70, 78, 85, 100],
  },
}

export const CHECKOUT_CLERK_PAY: Record<Furnishing, Record<ServiceTier, number[]>> = {
  unfurnished: {
    flex:     [20, 25, 30, 35, 40, 45, 50, 55, 60, 70],
    core:     [25, 30, 35, 40, 45, 50, 55, 60, 65, 75],
    priority: [30, 35, 40, 45, 50, 55, 60, 65, 70, 80],
  },
  furnished: {
    flex:     [25, 30, 35, 40, 50, 55, 60, 65, 70, 75],
    core:     [30, 35, 40, 45, 55, 60, 65, 70, 75, 80],
    priority: [35, 40, 45, 50, 60, 65, 70, 75, 80, 85],
  },
}

/**
 * Clerk-pay add-ons (rate card §3). Per-feature uplifts on the clerk payout,
 * applied once per job from the property's room/feature counts.
 *   - `*Pct` values are percentages, not pounds.
 *   - `communalLounge` is per-£0.50 so it carries a decimal.
 */
export type ClerkAddons = {
  /** Clerk pay for a standalone check-in service (no matrix entry). */
  checkInStandalone: number
  /** Clerk pay for a mid-term / interim service (no matrix entry). */
  interim: number
  /** Per kitchen beyond the first. */
  additionalKitchen: number
  /** Per bathroom/WC beyond the first. */
  additionalBathroom: number
  /** Per communal area. */
  communalLounge: number
  /** Per hallway/landing/stairs unit. */
  hallwaysStairs: number
  /** Per utility or storage room. */
  utilityStorage: number
  /** Per garden / outdoor space. */
  gardenOutdoor: number
  /** Flat, when the property is flagged heavily furnished. */
  heavilyFurnished: number
  /** Aborted-visit payout as a % of the job's clerk pay (admin-applied). */
  abortedVisitPct: number
}

export const DEFAULT_CLERK_ADDONS: ClerkAddons = {
  checkInStandalone: 20,
  interim: 25,
  additionalKitchen: 10,
  additionalBathroom: 5,
  communalLounge: 7.5,
  hallwaysStairs: 5,
  utilityStorage: 5,
  gardenOutdoor: 10,
  heavilyFurnished: 15,
  abortedVisitPct: 50,
}

/**
 * Client-facing add-ons (rate card §4). Unlike the clerk add-ons (which
 * uplift the clerk's pay), these uplift the price the CLIENT pays. Applied
 * once per job from the property's room/feature counts + furnishing.
 *
 * Model (admin-configurable):
 *   - Furnishing is a flat adder on top of an UNFURNISHED base service
 *     price (`furnishingPartFurnished` / `furnishingFurnished`).
 *   - Each room type charges `per<Type>` per unit ABOVE `free<Type>`
 *     included units. Setting a rate to 0 disables that line.
 *   - Hallways / utility / storage are never charged (no fields here).
 */
export type ClientAddons = {
  furnishingPartFurnished: number
  furnishingFurnished: number
  perBedroom: number
  perBathroom: number
  perLivingRoom: number
  perDiningArea: number
  perKitchen: number
  perGarden: number
  perCommunal: number
  perHallwaysStairs: number
  perUtilityRoom: number
  perStorageRoom: number
  freeBedrooms: number
  freeBathrooms: number
  freeLivingRooms: number
  freeDiningAreas: number
  freeKitchens: number
  freeGardens: number
  freeCommunal: number
  freeHallwaysStairs: number
  freeUtilityRooms: number
  freeStorageRooms: number
}

export const DEFAULT_CLIENT_ADDONS: ClientAddons = {
  furnishingPartFurnished: 5,
  furnishingFurnished: 10,
  perBedroom: 5,
  perBathroom: 5,
  perLivingRoom: 5,
  perDiningArea: 5,
  perKitchen: 5,
  perGarden: 20,
  perCommunal: 5,
  perHallwaysStairs: 5,
  perUtilityRoom: 5,
  perStorageRoom: 5,
  freeBedrooms: 1,
  freeBathrooms: 1,
  freeLivingRooms: 1,
  freeDiningAreas: 1,
  freeKitchens: 1,
  freeGardens: 0,
  freeCommunal: 0,
  freeHallwaysStairs: 0,
  freeUtilityRooms: 0,
  freeStorageRooms: 0,
}

/**
 * Cleaning service (rate card §5). A distinct, cleaner-performed service with
 * THREE levels, each priced by property size band. Unlike inventory/checkout
 * this is furnishing-agnostic and has no tier — the level *is* the variant.
 *
 * Two fully separate, generic price tables (neither side chooses):
 *   - `client`  — flat £ the Property Manager pays LISTD, per size band.
 *   - `cleaner` — what the cleaner earns: an hourly rate × a max-hours cap per
 *                 size band. Headline payout = `hourlyRate * maxHours` (the cap;
 *                 hours are a maximum).
 *
 * Size bands map onto the 10-entry {@link PROPERTY_SIZES} (studio…9_bed). The
 * spec's "7 bed+" fills bands 7/8/9 unless a higher band is given (Deep client
 * splits 7 = £650 and 8+ = £800).
 */
export const CLEAN_LEVELS = ['light', 'general', 'deep'] as const
export type CleanLevel = (typeof CLEAN_LEVELS)[number]

/** A cleaner-pay cell: hourly rate and the maximum hours it's capped at. */
export type CleanerPayBand = { hourlyRate: number; maxHours: number }

/**
 * Admin-defined cleaning offering (e.g. "After-builders clean"). Lives in the
 * rate card next to the built-in Light/General/Deep. Stored on
 * `jobs.inspection_type` as `clean_<key>`, so it flows to the cleaner
 * marketplace (which matches the `clean_` prefix) automatically.
 */
export type CustomCleanLevel = {
  /** Stable slug, e.g. `after_builders`. */
  key: string
  label: string
  enabled: boolean
  /** Flat client £ per size band (10 entries). */
  client: number[]
  /** Cleaner hourly rate (single) with a per-size max-hours cap (10). */
  hourlyRate: number
  maxHours: number[]
  /** Shown at booking ("what's included") and as the cleaner's checklist. */
  scope: string
  tasks: string[]
}

export type CleaningPricing = {
  /** Flat £ the client (property manager) pays, per size band. */
  client: Record<CleanLevel, number[]>
  /** Cleaner pay (hourly × max-hours cap), per size band. */
  cleaner: Record<CleanLevel, CleanerPayBand[]>
  /** Admin-defined additional offerings. */
  custom?: CustomCleanLevel[]
  /** Client-facing furnishing + per-room add-ons for CLEANS — the same
   *  item set as the inspection `clientAddons`, replicated so cleans carry
   *  their own admin-editable rates. Optional: pre-existing stored rate
   *  cards won't have it; falls back to the code defaults. */
  clientAddons?: ClientAddons
}

/** Convenience: build a 10-band cleaner-pay row from `[rate, hours]` pairs. */
function cleanerRow(pairs: [number, number][]): CleanerPayBand[] {
  return pairs.map(([hourlyRate, maxHours]) => ({ hourlyRate, maxHours }))
}

export const DEFAULT_CLEANING: CleaningPricing = {
  client: {
    //         studio 1bd  2bd  3bd  4bd  5bd  6bd  7bd  8bd  9bd
    light:   [   35,  45,  75,  85, 125, 145, 175, 200, 200, 200],
    general: [   75, 125, 150, 175, 195, 235, 295, 375, 375, 375],
    deep:    [  150, 175, 195, 295, 325, 450, 550, 650, 800, 800],
  },
  cleaner: {
    // [hourlyRate, maxHours] per size band.
    // NB 3-bed light hours = 1.45 per the spec (likely 1h45m = 1.75); confirm.
    light: cleanerRow([
      [15, 1], [15, 1], [16, 1.5], [17, 1.45], [18, 2],
      [19, 2.5], [20, 3.5], [22, 5], [22, 5], [22, 5],
    ]),
    general: cleanerRow([
      [15, 1.5], [15, 1.5], [16, 2], [18, 2], [20, 3],
      [23, 4], [25, 5], [28, 6], [28, 6], [28, 6],
    ]),
    deep: cleanerRow([
      [18, 2], [19, 2], [21, 3], [23, 3.5], [25, 4],
      [27, 4.5], [29, 5], [31, 6], [31, 6], [31, 6],
    ]),
  },
  // Same add-on items as inspections, replicated with their own rates.
  clientAddons: { ...DEFAULT_CLIENT_ADDONS },
}

export const CLEAN_LEVEL_LABELS: Record<CleanLevel, string> = {
  light: 'Light Clean',
  general: 'General Clean',
  deep: 'Deep Clean',
}

/** The `jobs.inspection_type` key a cleaning level is stored under. */
export const CLEAN_TYPE_KEYS: Record<CleanLevel, string> = {
  light: 'clean_light',
  general: 'clean_general',
  deep: 'clean_deep',
}

/** Reverse of {@link CLEAN_TYPE_KEYS} — resolve a job type back to a level. */
export function cleanLevelFromType(type: string): CleanLevel | null {
  switch (type) {
    case 'clean_light':
      return 'light'
    case 'clean_general':
      return 'general'
    case 'clean_deep':
      return 'deep'
    default:
      return null
  }
}

/** Any cleaning job — built-in level OR admin-defined offering. The cleaner
 *  marketplace, feeds and fan-out all key off this prefix. */
export function isCleaningType(type: string): boolean {
  return type.startsWith('clean_')
}

/** The `jobs.inspection_type` key for a clean offering key. */
export function cleanTypeKeyForLevel(level: string): string {
  return (CLEAN_TYPE_KEYS as Record<string, string>)[level] ?? `clean_${level}`
}

/** Admin-defined offering matching a level key (enabled or not). */
export function customCleanByKey(
  cleaning: CleaningPricing,
  level: string
): CustomCleanLevel | null {
  return cleaning.custom?.find((c) => c.key === level) ?? null
}

/** Admin-defined offering for a `clean_<key>` job type. */
export function customCleanFromType(
  cleaning: CleaningPricing,
  type: string
): CustomCleanLevel | null {
  if (!isCleaningType(type)) return null
  return customCleanByKey(cleaning, type.slice('clean_'.length))
}

export type CleanOffering = {
  /** Level key used at booking ('light' | … | custom slug). */
  key: string
  label: string
  /** The `jobs.inspection_type` value. */
  typeKey: string
  custom: boolean
}

/** Everything bookable on /book/clean: the built-in three + enabled customs. */
export function listCleanOfferings(cleaning: CleaningPricing): CleanOffering[] {
  const builtIns: CleanOffering[] = CLEAN_LEVELS.map((l) => ({
    key: l,
    label: CLEAN_LEVEL_LABELS[l],
    typeKey: CLEAN_TYPE_KEYS[l],
    custom: false,
  }))
  const customs: CleanOffering[] = (cleaning.custom ?? [])
    .filter((c) => c.enabled)
    .map((c) => ({
      key: c.key,
      label: c.label,
      typeKey: `clean_${c.key}`,
      custom: true,
    }))
  return [...builtIns, ...customs]
}

/**
 * Human label for a cleaning job type. Built-ins resolve statically; customs
 * from the rate card when provided, else a humanised slug ("clean_after_
 * builders" → "After Builders clean") so label sites never render raw keys.
 */
export function cleaningLabelFromType(
  type: string,
  cleaning?: CleaningPricing
): string | null {
  if (!isCleaningType(type)) return null
  const named: Record<string, string> = {
    clean_standard: 'Standard Home Cleaning',
    clean_deep: 'Deep Cleaning',
    clean_eot: 'End of Tenancy Cleaning',
    clean_office: 'Office Cleaning',
  }
  if (named[type]) return named[type]
  const builtin = cleanLevelFromType(type)
  if (builtin) return CLEAN_LEVEL_LABELS[builtin]
  if (cleaning) {
    const custom = customCleanFromType(cleaning, type)
    if (custom) return custom.label
  }
  const pretty = humanizeServiceKey(type.slice('clean_'.length))
  return `${pretty} clean`
}

/** The flat client (property-manager) price for a clean level + size.
 *  `level` accepts built-in levels and custom offering keys. */
export function resolveCleaningClientPrice(
  cleaning: CleaningPricing,
  level: string,
  size: PropertySize
): number {
  const idx = PROPERTY_SIZES.indexOf(size)
  if (idx === -1) return 0
  if ((CLEAN_LEVELS as readonly string[]).includes(level)) {
    return cleaning.client[level as CleanLevel]?.[idx] ?? 0
  }
  return customCleanByKey(cleaning, level)?.client?.[idx] ?? 0
}

export type CleanClientPriceBreakdown = {
  /** Flat clean price for the level + size band. */
  base: number
  /** Furnishing + per-room add-on lines (cleaning add-on rate card). */
  addons: ClerkPayoutLine[]
  addonsTotal: number
  /** base + addonsTotal — the caller adds the platform fee. */
  subtotal: number
}

/**
 * The full client price for a CLEAN, mirroring {@link computeClientPrice}
 * for inspections: flat level price + the same furnishing/per-room add-on
 * items, priced from the cleaning-specific `clientAddons` card (falling
 * back to the code defaults for stored rate cards that pre-date it). The
 * single source of truth for the clean booking UI and the
 * `cleaning/jobs/create` server recompute.
 */
export function computeCleanClientPrice(
  cleaning: CleaningPricing,
  input: {
    level: string
    size: PropertySize
    furnishing: FurnishedStatus
    features: ClientPropertyFeatures
  }
): CleanClientPriceBreakdown {
  const base = resolveCleaningClientPrice(cleaning, input.level, input.size)
  const { breakdown: addons, total: addonsTotal } = computeClientAddons(
    cleaning.clientAddons ?? DEFAULT_CLIENT_ADDONS,
    input.features,
    input.furnishing,
    input.size
  )
  return { base, addons, addonsTotal, subtotal: base + addonsTotal }
}

export type CleanerPay = { hourlyRate: number; maxHours: number; total: number }

/**
 * Cleaner pay for a clean level + size: the hourly rate, the max-hours cap, and
 * the headline `total` (= rate × maxHours). Total is what the cleaner is offered
 * for the job; hours are the cap on the work. Accepts custom offering keys.
 */
export function resolveCleaningCleanerPay(
  cleaning: CleaningPricing,
  level: string,
  size: PropertySize
): CleanerPay {
  const idx = PROPERTY_SIZES.indexOf(size)
  if (idx === -1) return { hourlyRate: 0, maxHours: 0, total: 0 }
  let band: CleanerPayBand | undefined
  if ((CLEAN_LEVELS as readonly string[]).includes(level)) {
    band = cleaning.cleaner[level as CleanLevel]?.[idx]
  } else {
    const custom = customCleanByKey(cleaning, level)
    if (custom) {
      band = { hourlyRate: custom.hourlyRate, maxHours: custom.maxHours?.[idx] ?? 0 }
    }
  }
  if (!band) return { hourlyRate: 0, maxHours: 0, total: 0 }
  const total = Math.round(band.hourlyRate * band.maxHours * 100) / 100
  return { hourlyRate: band.hourlyRate, maxHours: band.maxHours, total }
}

/**
 * Check-in is a flat fee by size band, no tiers, no furnishing impact.
 * Studio–2bed = £50, 3–5bed = £55, 6–9bed = £60.
 */
export const CHECKIN_PRICING: number[] = [50, 50, 50, 55, 55, 55, 60, 60, 60, 60]

/** Mid-term (and interim) inspection is a flat £50 across all sizes. */
export const MIDTERM_PRICING: number[] = [50, 50, 50, 50, 50, 50, 50, 50, 50, 50]

// ─── Booking-flow pricing helpers (port of `src/utils/pricing.ts`) ─────────

/** All inspection-type values from the Postgres `inspection_type` enum. */
export const INSPECTION_TYPES = [
  'new_inventory',
  'check_in',
  'check_out',
  'mid_term',
  'interim',
] as const
export type InspectionType = (typeof INSPECTION_TYPES)[number]

/** Furnishing values from the Postgres `furnished_status` enum. */
export const FURNISHED_STATUSES = ['unfurnished', 'furnished', 'part_furnished'] as const
export type FurnishedStatus = (typeof FURNISHED_STATUSES)[number]

/** Inspection types presented as primary services in the booking flow. */
export const PRIMARY_SERVICES: InspectionType[] = [
  'new_inventory',
  'check_out',
  'check_in',
  'mid_term',
]

/** Services that need a tier choice (flex/core/priority). */
export const TIERED_SERVICES: InspectionType[] = ['new_inventory', 'check_out']

/** Services where furnishing affects pricing. */
export const FURNISHING_SERVICES: InspectionType[] = ['new_inventory', 'check_out']

/** Whether this service requires a tier selection. Custom types backed by the
 *  inventory/checkout models are tiered. */
export function serviceRequiresTier(
  type: string,
  customTypes: CustomServiceType[] = []
): boolean {
  if ((TIERED_SERVICES as readonly string[]).includes(type)) return true
  const c = customTypes.find((x) => x.key === type)
  return c ? c.baseModel === 'inventory' || c.baseModel === 'checkout' : false
}

/** Whether furnishing affects pricing for this service. */
export function serviceUsesFurnishing(
  type: string,
  customTypes: CustomServiceType[] = []
): boolean {
  if ((FURNISHING_SERVICES as readonly string[]).includes(type)) return true
  const c = customTypes.find((x) => x.key === type)
  return c ? c.baseModel === 'inventory' || c.baseModel === 'checkout' : false
}

/** Whether this service requires primary tenant details (like Check-In). */
export function serviceRequiresTenant(
  type: string,
  customTypes: CustomServiceType[] = []
): boolean {
  if (type === 'check_in') return true
  return customTypes.find((x) => x.key === type)?.requiresTenant ?? false
}

export type SignoffBy = 'client' | 'tenant'
export type SignoffPolicy = {
  /** Who signs the delivered report. */
  signoffBy: SignoffBy
  /** Whether the client must acknowledge read & receipt (only when the tenant
   *  signs). */
  clientAckRequired: boolean
}

/**
 * Resolve who signs a service's report and whether the client must acknowledge
 * receipt. Custom types carry their own config; built-in services default to
 * "tenant signs, client acknowledges read & receipt".
 */
export function resolveSignoffPolicy(
  serviceKey: string,
  customTypes: CustomServiceType[] = []
): SignoffPolicy {
  const c = customTypes.find((x) => x.key === serviceKey)
  if (c) {
    const signoffBy: SignoffBy = c.signoffBy === 'client' ? 'client' : 'tenant'
    return {
      signoffBy,
      clientAckRequired:
        signoffBy === 'tenant'
          ? c.clientAcknowledgementRequired ?? true
          : false,
    }
  }
  // Built-in services: the tenant signs, the client acknowledges receipt.
  return { signoffBy: 'tenant', clientAckRequired: true }
}

/** Urgency surcharge constants (M1/M2 booking flow). */
export const SHORT_NOTICE_SURCHARGE = 30 // £30 within 24h
export const SHORT_NOTICE_THRESHOLD_HOURS = 24
export const SAME_DAY_SURCHARGE = 50 // £50 within 12h
export const SAME_DAY_THRESHOLD_HOURS = 12

/**
 * Card-processing cost recovery, borne by the CLIENT and shown as the
 * "Platform fee". Based on Stripe's UK standard domestic card pricing
 * (1.5% + £0.20) and grossed-up so the fee is charged on the whole amount
 * the client pays — including the fee itself — leaving the service price
 * intact after Stripe's cut: total = (amount + fixed) / (1 - pct).
 */
export const CARD_FEE_PCT = 0.015
export const CARD_FEE_FIXED = 0.2

/** The "Platform fee" for a charge of `amount` pounds. 0 for £0 amounts. */
export function computePlatformFee(amount: number): number {
  if (amount <= 0) return 0
  const grossed = (amount + CARD_FEE_FIXED) / (1 - CARD_FEE_PCT)
  return Math.round((grossed - amount) * 100) / 100
}

/**
 * The complete set of client-facing rate matrices for a (service, furnishing,
 * tier, size) lookup. The code constants above are the **defaults**
 * ({@link DEFAULT_PRICING}); admins can override them at runtime — the
 * effective set is loaded by `lib/pricing-settings.ts` and resolved with
 * {@link resolvePricing}.
 */
export type FurnishedMatrix = Record<ServiceTier, number[]>

/** Pricing/behaviour template a custom service type is backed by. */
export type ServiceBaseModel = 'inventory' | 'checkout' | 'flat_size' | 'flat_fixed'

/**
 * An admin-defined booking type. Backed by one of the {@link ServiceBaseModel}
 * templates so it reuses the inspection wizard, report renderer, and pricing
 * machinery. Carries its own client + clerk prices in the shape its base model
 * needs. Stored in the rate card (`PricingMatrices.customTypes`).
 */
export type CustomServiceType = {
  /** Stable slug, e.g. `fire_safety_check`. Stored on `jobs.inspection_type`. */
  key: string
  label: string
  baseModel: ServiceBaseModel
  /** Require primary tenant details (like Check-In). */
  requiresTenant: boolean
  /** Offer it in the client booking flow. */
  showInBooking: boolean
  enabled: boolean
  /** Who signs the delivered report. 'client' (e.g. Fire Safety, EPC) or
   *  'tenant' (default — most inspections). */
  signoffBy?: 'client' | 'tenant'
  /** When the TENANT signs, also require the client to acknowledge they've
   *  read and received the report (recorded + admin-notified). Defaults true. */
  clientAcknowledgementRequired?: boolean
  // Pricing — only the fields for `baseModel` are used.
  clientMatrix?: Record<Furnishing, FurnishedMatrix> // inventory | checkout
  clerkMatrix?: Record<Furnishing, FurnishedMatrix>
  clientFlat?: number[] // flat_size (one per size band)
  clerkFlat?: number[]
  clientFixed?: number // flat_fixed
  clerkFixed?: number
}

export type PricingMatrices = {
  /** Client price. */
  inventory: Record<Furnishing, FurnishedMatrix>
  checkout: Record<Furnishing, FurnishedMatrix>
  /** Client flat fee by size band (no tiers / furnishing). */
  checkin: number[]
  /** Client flat fee across all sizes. */
  midterm: number[]
  /** Clerk pay (payout). */
  inventoryClerk: Record<Furnishing, FurnishedMatrix>
  checkoutClerk: Record<Furnishing, FurnishedMatrix>
  /** Clerk-pay add-ons (per-feature uplifts + flat service payouts). */
  addons: ClerkAddons
  /** Client-facing per-feature + furnishing add-ons. */
  clientAddons: ClientAddons
  /** Cleaning service — 3 levels, dual-sided (client + cleaner) by size. */
  cleaning: CleaningPricing
  /** Admin-defined booking types. */
  customTypes: CustomServiceType[]
}

/** Code-governed defaults — the fallback when no admin override is stored. */
export const DEFAULT_PRICING: PricingMatrices = {
  inventory: INVENTORY_CLIENT_PRICING,
  checkout: CHECKOUT_CLIENT_PRICING,
  checkin: CHECKIN_PRICING,
  midterm: MIDTERM_PRICING,
  inventoryClerk: INVENTORY_CLERK_PAY,
  checkoutClerk: CHECKOUT_CLERK_PAY,
  addons: DEFAULT_CLERK_ADDONS,
  clientAddons: DEFAULT_CLIENT_ADDONS,
  cleaning: DEFAULT_CLEANING,
  customTypes: [],
}

/** Property room/feature counts that drive the clerk-pay add-ons. */
export type PropertyFeatures = {
  bathrooms: number
  kitchens: number
  utilityRooms: number
  storageRooms: number
  hallwaysStairs: number
  gardens: number
  communalAreas: number
  heavilyFurnished: boolean
}

export type ClerkPayoutLine = { label: string; amount: number }
export type ClerkPayout = { total: number; breakdown: ClerkPayoutLine[] }

/**
 * Defensively parse the `clerk_payout_breakdown` jsonb column into its itemised
 * lines. The stored shape is `{ source, computedAt, lines: ClerkPayoutLine[] }`;
 * legacy rows default to `{}` (no lines). Anything malformed → `[]`, so callers
 * can render the breakdown when present and gracefully fall back to the bare
 * total otherwise.
 */
export function parseClerkPayoutLines(value: unknown): ClerkPayoutLine[] {
  if (!value || typeof value !== 'object') return []
  const lines = (value as { lines?: unknown }).lines
  if (!Array.isArray(lines)) return []
  return lines.flatMap((l) => {
    if (!l || typeof l !== 'object') return []
    const { label, amount } = l as { label?: unknown; amount?: unknown }
    if (typeof label !== 'string' || typeof amount !== 'number') return []
    return [{ label, amount }]
  })
}

/**
 * Clerk pay for a single matrix-priced service (new_inventory / check_out).
 * `part_furnished` is the midpoint, same as client pricing. check_in and
 * mid_term/interim have no matrix — their clerk pay comes from the add-ons
 * (see {@link computeClerkPayout}).
 */
export function resolveClerkPay(
  matrices: PricingMatrices,
  inspectionType: string,
  size: PropertySize,
  tier: ServiceTier,
  furnishing: FurnishedStatus
): number {
  const idx = PROPERTY_SIZES.indexOf(size)
  if (idx === -1) return 0
  switch (inspectionType) {
    case 'new_inventory':
      return furnishedMatrixPrice(matrices.inventoryClerk, tier, idx, furnishing)
    case 'check_out':
      return furnishedMatrixPrice(matrices.checkoutClerk, tier, idx, furnishing)
    case 'check_in':
    case 'mid_term':
    case 'interim':
      return 0 // clerk pay via add-ons (see computeClerkPayout)
    default:
      return customPrice(matrices, inspectionType, idx, tier, furnishing, 'clerk')
  }
}

/**
 * Total clerk payout for a job: per-service clerk pay (matrix, or the flat
 * check-in / interim add-on) plus the per-feature property add-ons, applied
 * once per job. Returns an itemised breakdown for the audit trail / payout
 * record. The aborted-visit % is admin-applied, not included here.
 */
export function computeClerkPayout(
  matrices: PricingMatrices,
  services: string[],
  size: PropertySize,
  tier: ServiceTier,
  furnishing: FurnishedStatus,
  property: PropertyFeatures
): ClerkPayout {
  const breakdown: ClerkPayoutLine[] = []
  const a = matrices.addons

  for (const service of services) {
    let amount = 0
    if (service === 'check_in') {
      amount = a.checkInStandalone
    } else if (service === 'mid_term' || service === 'interim') {
      amount = a.interim
    } else {
      // new_inventory / check_out / custom types
      amount = resolveClerkPay(matrices, service, size, tier, furnishing)
    }
    if (amount > 0) {
      breakdown.push({ label: serviceLabel(service, matrices.customTypes), amount })
    }
  }

  const addon = (label: string, qty: number, rate: number) => {
    const amount = qty * rate
    if (amount > 0) breakdown.push({ label, amount })
  }
  addon('Additional kitchen', Math.max(0, property.kitchens - 1), a.additionalKitchen)
  addon('Additional bathroom/WC', Math.max(0, property.bathrooms - 1), a.additionalBathroom)
  addon('Communal area', property.communalAreas, a.communalLounge)
  addon('Hallways/landings/stairs', property.hallwaysStairs, a.hallwaysStairs)
  addon('Utility/storage room', property.utilityRooms + property.storageRooms, a.utilityStorage)
  addon('Garden/outdoor space', property.gardens, a.gardenOutdoor)
  if (property.heavilyFurnished && a.heavilyFurnished > 0) {
    breakdown.push({ label: 'Heavily furnished', amount: a.heavilyFurnished })
  }

  const total = breakdown.reduce((sum, line) => sum + line.amount, 0)
  return { total, breakdown }
}

/** Price a custom service type's cell from its own (client or clerk) pricing. */
function customPrice(
  matrices: PricingMatrices,
  key: string,
  idx: number,
  tier: ServiceTier,
  furnishing: FurnishedStatus,
  side: 'client' | 'clerk'
): number {
  const t = matrices.customTypes.find((c) => c.key === key)
  if (!t) return 0
  switch (t.baseModel) {
    case 'inventory':
    case 'checkout': {
      const m = side === 'client' ? t.clientMatrix : t.clerkMatrix
      return m ? furnishedMatrixPrice(m, tier, idx, furnishing) : 0
    }
    case 'flat_size': {
      const arr = side === 'client' ? t.clientFlat : t.clerkFlat
      return arr?.[idx] ?? 0
    }
    case 'flat_fixed':
      return (side === 'client' ? t.clientFixed : t.clerkFixed) ?? 0
    default:
      return 0
  }
}

export type BookableService = {
  key: string
  label: string
  requiresTier: boolean
  usesFurnishing: boolean
  requiresTenant: boolean
  custom: boolean
}

/**
 * The services offered in the client booking flow: the built-in primary
 * services plus any enabled, booking-visible custom types.
 */
export function getBookableServices(matrices: PricingMatrices): BookableService[] {
  const builtIns: BookableService[] = PRIMARY_SERVICES.map((key) => ({
    key,
    label: serviceLabel(key, matrices.customTypes),
    requiresTier: serviceRequiresTier(key, matrices.customTypes),
    usesFurnishing: serviceUsesFurnishing(key, matrices.customTypes),
    requiresTenant: serviceRequiresTenant(key, matrices.customTypes),
    custom: false,
  }))
  const custom: BookableService[] = matrices.customTypes
    .filter((c) => c.enabled && c.showInBooking)
    .map((c) => ({
      key: c.key,
      label: c.label,
      requiresTier: c.baseModel === 'inventory' || c.baseModel === 'checkout',
      usesFurnishing: c.baseModel === 'inventory' || c.baseModel === 'checkout',
      requiresTenant: c.requiresTenant,
      custom: true,
    }))
  return [...builtIns, ...custom]
}

/** Human label for any service key — built-in, custom, or unknown. */
export function serviceLabel(
  key: string,
  customTypes: CustomServiceType[] = []
): string {
  const builtIn = (BUILTIN_INSPECTION_TYPE_LABELS as Record<string, string>)[key]
  if (builtIn) return builtIn
  return customTypes.find((c) => c.key === key)?.label ?? humanizeServiceKey(key)
}

/** Title-case a slug as a fallback label (`fire_safety` → `Fire Safety`). */
export function humanizeServiceKey(key: string): string {
  return key
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim()
}

/**
 * Resolve the client-facing price for a (service, size, tier, furnishing)
 * tuple against a specific set of matrices (defaults or admin-overridden).
 *
 * `part_furnished` is priced at the **midpoint** of the unfurnished and
 * furnished prices for the same (tier, size), rounded to the nearest pound —
 * it's less work than a fully furnished property and more than an empty one.
 */
export function resolvePricing(
  matrices: PricingMatrices,
  inspectionType: string,
  size: PropertySize,
  tier: ServiceTier,
  furnishing: FurnishedStatus
): number {
  const idx = PROPERTY_SIZES.indexOf(size)
  if (idx === -1) return 0

  switch (inspectionType) {
    case 'new_inventory':
      return furnishedMatrixPrice(matrices.inventory, tier, idx, furnishing)
    case 'check_out':
      return furnishedMatrixPrice(matrices.checkout, tier, idx, furnishing)
    case 'check_in':
      return matrices.checkin[idx] ?? 0
    case 'mid_term':
    case 'interim':
      return matrices.midterm[idx] ?? 0
    default:
      return customPrice(matrices, inspectionType, idx, tier, furnishing, 'client')
  }
}

/**
 * UNFURNISHED base price for a service — the starting point of the
 * client-facing additive model (base + furnishing adder + room add-ons).
 * For inventory/checkout this is the unfurnished matrix value; check_in /
 * mid_term / interim are furnishing-agnostic so it's their flat row; custom
 * types use their unfurnished base. Furnishing is added separately via
 * {@link computeClientAddons}, so this must NOT fold it in.
 */
export function resolveServiceBase(
  matrices: PricingMatrices,
  inspectionType: string,
  size: PropertySize,
  tier: ServiceTier
): number {
  return resolvePricing(matrices, inspectionType, size, tier, 'unfurnished')
}

/** Property room counts that drive the client add-ons. */
export type ClientPropertyFeatures = {
  bedrooms: number
  bathrooms: number
  livingRooms: number
  diningAreas: number
  kitchens: number
  gardens: number
  communalAreas: number
  hallwaysStairs: number
  utilityRooms: number
  storageRooms: number
}

/** Bedrooms already covered by a size band's base price: `2_bed` → 2, etc.
 *  A studio's base covers the studio room itself, so 0 separate bedrooms. */
export function bedroomsIncludedInSize(size: PropertySize): number {
  if (size === 'studio') return 0
  const n = Number.parseInt(size, 10)
  return Number.isFinite(n) ? n : 0
}

/**
 * Client add-on lines: the flat furnishing adder + per-room charges above
 * the included-free baseline. Mirrors {@link computeClerkPayout}'s shape
 * (itemised breakdown + total) but on the CLIENT side.
 *
 * `size` matters for bedrooms: the base price the client pays already scales
 * with the size band (a `2_bed` base IS the 2-bedroom price), so bedrooms up
 * to the band count are treated as included — only bedrooms beyond the band
 * (or beyond `freeBedrooms`, whichever is higher) bill as extras. Without
 * this, a 2-bed booking was charged the 2-bed base AND an "extra bedroom".
 */
export function computeClientAddons(
  a: ClientAddons,
  features: ClientPropertyFeatures,
  furnishing: FurnishedStatus,
  size?: PropertySize
): { total: number; breakdown: ClerkPayoutLine[] } {
  const lines: ClerkPayoutLine[] = []

  if (furnishing === 'part_furnished' && a.furnishingPartFurnished > 0) {
    lines.push({ label: 'Part-furnished', amount: a.furnishingPartFurnished })
  } else if (furnishing === 'furnished' && a.furnishingFurnished > 0) {
    lines.push({ label: 'Furnished', amount: a.furnishingFurnished })
  }

  const room = (label: string, count: number, free: number, rate: number) => {
    const extra = Math.max(0, count - free)
    const amount = extra * rate
    if (amount > 0) lines.push({ label: `${label} ×${extra}`, amount })
  }
  const freeBedrooms = Math.max(
    a.freeBedrooms,
    size ? bedroomsIncludedInSize(size) : 0
  )
  room('Extra bedroom', features.bedrooms, freeBedrooms, a.perBedroom)
  room('Extra bathroom/WC', features.bathrooms, a.freeBathrooms, a.perBathroom)
  room('Extra living room', features.livingRooms, a.freeLivingRooms, a.perLivingRoom)
  room('Extra dining area', features.diningAreas, a.freeDiningAreas, a.perDiningArea)
  room('Extra kitchen', features.kitchens, a.freeKitchens, a.perKitchen)
  room('Garden / outdoor', features.gardens, a.freeGardens, a.perGarden)
  room('Communal area', features.communalAreas, a.freeCommunal, a.perCommunal)
  room('Hallways / stairs', features.hallwaysStairs, a.freeHallwaysStairs, a.perHallwaysStairs)
  room('Utility room', features.utilityRooms, a.freeUtilityRooms, a.perUtilityRoom)
  room('Storage room', features.storageRooms, a.freeStorageRooms, a.perStorageRoom)

  const total = lines.reduce((sum, l) => sum + l.amount, 0)
  return { total, breakdown: lines }
}

export type ClientPriceLine = { type: string; label: string; price: number }
export type ClientPriceBreakdown = {
  /** Base UNFURNISHED price per selected service. */
  services: ClientPriceLine[]
  servicesTotal: number
  /** Furnishing adder + per-room add-on lines. */
  addons: ClerkPayoutLine[]
  addonsTotal: number
  /** services + addons (does NOT include the urgency surcharge — that's
   *  date-dependent and added by the caller). */
  subtotal: number
}

/**
 * The full client price for a booking, sans urgency surcharge: base
 * (unfurnished) per service + furnishing adder + per-room add-ons. The
 * single source of truth used by the booking flow's price views and the
 * authoritative `jobs/create` recompute. Callers add
 * {@link calculateUrgencyFee} for the grand total.
 */
export function computeClientPrice(
  matrices: PricingMatrices,
  input: {
    services: string[]
    size: PropertySize
    tier: ServiceTier
    furnishing: FurnishedStatus
    features: ClientPropertyFeatures
  }
): ClientPriceBreakdown {
  const services: ClientPriceLine[] = input.services.map((type) => ({
    type,
    label: serviceLabel(type, matrices.customTypes),
    price: resolveServiceBase(matrices, type, input.size, input.tier),
  }))
  const servicesTotal = services.reduce((sum, l) => sum + l.price, 0)
  const { breakdown: addons, total: addonsTotal } = computeClientAddons(
    matrices.clientAddons,
    input.features,
    input.furnishing,
    input.size
  )
  return {
    services,
    servicesTotal,
    addons,
    addonsTotal,
    subtotal: servicesTotal + addonsTotal,
  }
}

/**
 * Convenience lookup against the code {@link DEFAULT_PRICING}. Use
 * {@link resolvePricing} with the effective matrices where admin overrides
 * must apply (booking flow + `jobs/create`).
 */
export function getServicePrice(
  inspectionType: string,
  size: PropertySize,
  tier: ServiceTier,
  furnishing: FurnishedStatus
): number {
  return resolvePricing(DEFAULT_PRICING, inspectionType, size, tier, furnishing)
}

/**
 * Resolve a price from a furnishing-aware matrix. `part_furnished` resolves to
 * `round((unfurnished + furnished) / 2)`; the others read their matrix row.
 */
function furnishedMatrixPrice(
  matrix: Record<Furnishing, FurnishedMatrix>,
  tier: ServiceTier,
  idx: number,
  furnishing: FurnishedStatus
): number {
  if (furnishing === 'part_furnished') {
    const unfurnished = matrix.unfurnished[tier][idx] ?? 0
    const furnished = matrix.furnished[tier][idx] ?? 0
    return Math.round((unfurnished + furnished) / 2)
  }
  const key: Furnishing = furnishing === 'unfurnished' ? 'unfurnished' : 'furnished'
  return matrix[key][tier][idx] ?? 0
}

/** Flat urgency fee for a scheduled date, given current time. */
export function calculateUrgencyFee(scheduledDate: Date, now = new Date()): number {
  const hoursUntil = (scheduledDate.getTime() - now.getTime()) / (1000 * 60 * 60)
  if (hoursUntil <= SAME_DAY_THRESHOLD_HOURS) return SAME_DAY_SURCHARGE
  if (hoursUntil <= SHORT_NOTICE_THRESHOLD_HOURS) return SHORT_NOTICE_SURCHARGE
  return 0
}

// ─── Display labels ────────────────────────────────────────────────────────

export const PROPERTY_TYPE_LABELS: Record<PropertySize, string> = {
  studio: 'Studio',
  '1_bed': '1 Bedroom',
  '2_bed': '2 Bedrooms',
  '3_bed': '3 Bedrooms',
  '4_bed': '4 Bedrooms',
  '5_bed': '5 Bedrooms',
  '6_bed': '6 Bedrooms',
  '7_bed': '7 Bedrooms',
  '8_bed': '8 Bedrooms',
  '9_bed': '9 Bedrooms',
}

export const FURNISHED_STATUS_LABELS: Record<FurnishedStatus, string> = {
  unfurnished: 'Unfurnished',
  furnished: 'Furnished',
  part_furnished: 'Part Furnished',
}

const BUILTIN_INSPECTION_TYPE_LABELS: Record<InspectionType, string> = {
  new_inventory: 'New Inventory',
  check_in: 'Check-In',
  check_out: 'Check-Out',
  mid_term: 'Mid-Term Inspection',
  interim: 'Interim Inspection',
}

/**
 * Built-in service labels, wrapped in a Proxy that returns a humanised
 * fallback for any unknown key (e.g. admin-defined custom types). This lets
 * the many display sites doing `INSPECTION_TYPE_LABELS[key]` render a sensible
 * label for custom types without each one loading the registry. For the
 * admin's *exact* custom label (where it differs from the key), use
 * {@link serviceLabel} with the effective `customTypes`.
 */
export const INSPECTION_TYPE_LABELS: Record<InspectionType, string> = new Proxy(
  BUILTIN_INSPECTION_TYPE_LABELS,
  {
    get(target, prop) {
      if (typeof prop === 'string' && !(prop in target)) {
        return humanizeServiceKey(prop)
      }
      return target[prop as InspectionType]
    },
  }
)

export const TIER_LABELS: Record<ServiceTier, string> = {
  flex: 'Flex',
  core: 'Core',
  priority: 'Priority',
}
