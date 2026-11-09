import {
  COVERAGE,
  feeFromBase,
  priceCleaning,
  priceDiagnosis,
  priceInspection,
  quoteTotals,
  requiredCleanLevel,
  type CleanAddon,
  type CleanCondition,
  type CleanType,
  type Furnishing,
  type InspectionKey,
  type PricedProperty,
  type Pricing,
  type ProBase,
  type ProRole,
  type QuoteLine,
  type Sched,
  type ServiceKey,
} from './pricing'

/**
 * Mapping between the design's six services and what the shared database
 * stores in `jobs.inspection_type`, plus the plan for a booking.
 * Pure: safe in the browser (price preview) and on the server.
 */

export const SERVICE_LABEL: Record<ServiceKey, string> = {
  INVENTORY: 'Inventory',
  CHECK_IN: 'Check-In',
  MID_TERM: 'Mid-Term',
  CHECK_OUT: 'Check-Out',
  REPAIRS_DAMAGES: 'Repairs & Maintenance',
  CLEANING: 'Cleaning',
}

const TO_DB: Record<Exclude<ServiceKey, 'CLEANING'>, string> = {
  INVENTORY: 'new_inventory',
  CHECK_IN: 'check_in',
  MID_TERM: 'mid_term',
  CHECK_OUT: 'check_out',
  REPAIRS_DAMAGES: 'repairs',
}

export function inspectionTypeFor(service: ServiceKey, clean?: CleanType): string {
  return service === 'CLEANING' ? `clean_${clean ?? 'standard'}` : TO_DB[service]
}

export function serviceFromType(type: string): ServiceKey {
  if (type.startsWith('clean_')) return 'CLEANING'
  switch (type) {
    case 'check_in':
      return 'CHECK_IN'
    case 'check_out':
      return 'CHECK_OUT'
    case 'mid_term':
    case 'interim':
      return 'MID_TERM'
    case 'repairs':
      return 'REPAIRS_DAMAGES'
    default:
      return 'INVENTORY'
  }
}

export function roleForService(service: ServiceKey): ProRole {
  if (service === 'CLEANING') return 'CLEANER'
  if (service === 'REPAIRS_DAMAGES') return 'TRADES'
  return 'CLERK'
}

export function roleForType(type: string): ProRole {
  return roleForService(serviceFromType(type))
}

/** The `app_role` value that holds each Pro role. */
export const APP_ROLE_FOR: Record<ProRole, 'clerk' | 'cleaner' | 'trades'> = {
  CLERK: 'clerk',
  CLEANER: 'cleaner',
  TRADES: 'trades',
}

/**
 * Level a job needs in its role. Clerk: up to 2 beds Level 1, up to 4 Level 2,
 * larger Level 3. Cleaner: by clean type. Trades: rate only, never a gate.
 */
export function requiredLevelFor(type: string, bedrooms: number): number {
  const service = serviceFromType(type)
  if (service === 'CLEANING') return requiredCleanLevel(type.slice('clean_'.length))
  if (service === 'REPAIRS_DAMAGES') return 1
  return bedrooms <= 2 ? 1 : bedrooms <= 4 ? 2 : 3
}

/** Shape a stored property into what the pricing engine needs. */
export function toPricedProperty(row: {
  bedrooms: number | null
  bathrooms: number | null
  kitchens: number | null
  livingRooms?: number | null
  diningAreas?: number | null
  furnishedStatus?: string | null
  heavilyFurnished?: boolean | null
  areaM2?: number | null
  outbuildings?: boolean | null
  outdoor?: boolean | null
}): PricedProperty {
  const furnishing: Furnishing = row.heavilyFurnished
    ? 'heavy'
    : row.furnishedStatus === 'furnished'
      ? 'furnished'
      : row.furnishedStatus === 'part_furnished'
        ? 'part'
        : 'unfurnished'
  return {
    bedrooms: row.bedrooms ?? 0,
    bathrooms: row.bathrooms ?? 1,
    kitchens: row.kitchens ?? 1,
    // One living room is included in the size price.
    extraReceptions: Math.max(0, (row.livingRooms ?? 1) - 1) + Math.max(0, row.diningAreas ?? 0),
    furnishing,
    areaM2: row.areaM2 ?? null,
    outbuildings: Boolean(row.outbuildings),
    outdoor: Boolean(row.outdoor),
  }
}

export type BookingScope = {
  clean?: CleanType
  condition?: CleanCondition
  addons?: CleanAddon[]
  carpetRooms?: number
  areaM2?: number
  frequency?: string
  facilities?: string
  repairMode?: 'diagnose' | 'fixed'
  category?: string
  location?: string
  description?: string
  severity?: string
}

/**
 * What happens to one service when it's booked.
 *   pay:   fixed price, goes straight to checkout (inspections, repair diagnosis)
 *   quote: LISTD issues a fixed quote first (cleaning, fixed repairs, custom sizes)
 */
export type ServicePlan = {
  service: ServiceKey
  inspectionType: string
  requiredLevel: number
  mode: 'pay' | 'quote'
  lines: QuoteLine[]
  subP: number
  taxP: number
  totalP: number
  /** Workload behind the fee; null for repairs, where the fee is set on the quote. */
  proBase: ProBase | null
  /** Fee when a Pro of the minimum level accepts, or the fixed repair fee. */
  proFeeP: number | null
  durationMin: number | null
  /** Cleaning shows this range until LISTD confirms the fixed quote. */
  estLowP: number | null
  estHighP: number | null
  /** Why LISTD has to price this one. */
  reason: string | null
}

export function planService(
  pr: Pricing,
  service: ServiceKey,
  property: PricedProperty,
  o: { sched: Sched; sameVisit?: boolean; scope?: BookingScope }
): ServicePlan {
  const scope = o.scope ?? {}
  const type = inspectionTypeFor(service, scope.clean)
  const base = {
    service,
    inspectionType: type,
    requiredLevel: requiredLevelFor(type, property.bedrooms),
    estLowP: null,
    estHighP: null,
    reason: null,
  }

  if (service === 'CLEANING') {
    const r = priceCleaning(pr, property, { clean: scope.clean ?? 'standard', condition: scope.condition, addons: scope.addons, carpetRooms: scope.carpetRooms, areaM2: scope.areaM2 }, { sched: o.sched })
    const t = quoteTotals(pr, r.lines)
    return {
      ...base,
      mode: 'quote',
      lines: r.lines,
      subP: t.subP,
      taxP: t.taxP,
      totalP: t.totalP,
      proBase: r.proBase,
      proFeeP: feeFromBase(pr, r.proBase),
      durationMin: r.durationMin,
      estLowP: r.estLowP,
      estHighP: r.estHighP,
      reason: 'LISTD confirms a fixed quote before you pay',
    }
  }

  if (service === 'REPAIRS_DAMAGES') {
    if (scope.repairMode === 'diagnose') {
      const d = priceDiagnosis(pr)
      const t = quoteTotals(pr, d.lines)
      return { ...base, mode: 'pay', lines: d.lines, subP: t.subP, taxP: t.taxP, totalP: t.totalP, proBase: null, proFeeP: d.proFeeP, durationMin: d.durationMin }
    }
    return { ...base, mode: 'quote', lines: [], subP: 0, taxP: 0, totalP: 0, proBase: null, proFeeP: null, durationMin: null, reason: 'priced from the damage reported' }
  }

  const r = priceInspection(pr, service as InspectionKey, property, { combo: o.sameVisit, sched: o.sched })
  if ('custom' in r) {
    return { ...base, mode: 'quote', lines: [], subP: 0, taxP: 0, totalP: 0, proBase: null, proFeeP: null, durationMin: null, reason: r.custom }
  }
  const t = quoteTotals(pr, r.lines)
  return { ...base, mode: 'pay', lines: r.lines, subP: t.subP, taxP: t.taxP, totalP: t.totalP, proBase: r.proBase, proFeeP: feeFromBase(pr, r.proBase), durationMin: r.durationMin }
}

/** Inventory + check-in booked together on one visit share the combined price. */
export function isSameVisit(services: ServiceKey[], requested: boolean | undefined): boolean {
  return services.includes('INVENTORY') && services.includes('CHECK_IN') && requested !== false
}

export { COVERAGE }
