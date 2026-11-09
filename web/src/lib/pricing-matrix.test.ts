import { describe, it, expect } from 'vitest'
import {
  CHECKIN_PRICING,
  CHECKOUT_CLERK_PAY,
  CHECKOUT_CLIENT_PRICING,
  CLEAN_TYPE_KEYS,
  DEFAULT_PRICING,
  INVENTORY_CLERK_PAY,
  INVENTORY_CLIENT_PRICING,
  MIDTERM_PRICING,
  PROPERTY_SIZES,
  computeClerkPayout,
  computeClientAddons,
  computeClientPrice,
  computePlatformFee,
  getBookableServices,
  getServicePrice,
  cleanLevelFromType,
  resolveCleaningClientPrice,
  resolveCleaningCleanerPay,
  resolveClerkPay,
  resolvePricing,
  resolveServiceBase,
  serviceLabel,
  serviceRequiresTenant,
  serviceRequiresTier,
  type ClientPropertyFeatures,
  type CustomServiceType,
  type PricingMatrices,
} from './pricing-matrix'

const NO_CLIENT_FEATURES: ClientPropertyFeatures = {
  bedrooms: 1,
  bathrooms: 1,
  livingRooms: 1,
  diningAreas: 1,
  kitchens: 1,
  gardens: 0,
  communalAreas: 0,
  hallwaysStairs: 0,
  utilityRooms: 0,
  storageRooms: 0,
}

const NO_FEATURES = {
  bathrooms: 1,
  kitchens: 1,
  utilityRooms: 0,
  storageRooms: 0,
  hallwaysStairs: 0,
  gardens: 0,
  communalAreas: 0,
  heavilyFurnished: false,
}

/**
 * Regression-locks the canonical pricing matrices against the values
 * published in `listd_master_rate_card.pdf`. M0 task #7.
 *
 * If the rate card changes, update the matrices in `pricing-matrix.ts` AND
 * the expected arrays here in lockstep — the test failure is the
 * change-control checkpoint.
 */

describe('PROPERTY_SIZES', () => {
  it('has exactly 10 size bands in the published order', () => {
    expect(PROPERTY_SIZES).toEqual([
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
    ])
  })
})

describe('INVENTORY_CLIENT_PRICING : rate card §1', () => {
  it('matches unfurnished × flex', () => {
    expect(INVENTORY_CLIENT_PRICING.unfurnished.flex).toEqual([
      60, 70, 85, 100, 120, 135, 150, 170, 185, 200,
    ])
  })

  it('matches unfurnished × core', () => {
    expect(INVENTORY_CLIENT_PRICING.unfurnished.core).toEqual([
      70, 90, 110, 130, 150, 170, 190, 210, 230, 250,
    ])
  })

  it('matches unfurnished × priority', () => {
    expect(INVENTORY_CLIENT_PRICING.unfurnished.priority).toEqual([
      90, 110, 130, 150, 170, 190, 220, 240, 260, 280,
    ])
  })

  it('matches furnished × flex', () => {
    expect(INVENTORY_CLIENT_PRICING.furnished.flex).toEqual([
      70, 80, 95, 115, 140, 155, 170, 190, 205, 220,
    ])
  })

  it('matches furnished × core', () => {
    expect(INVENTORY_CLIENT_PRICING.furnished.core).toEqual([
      80, 100, 125, 145, 170, 190, 210, 230, 250, 270,
    ])
  })

  it('matches furnished × priority', () => {
    expect(INVENTORY_CLIENT_PRICING.furnished.priority).toEqual([
      100, 120, 145, 165, 190, 210, 240, 260, 280, 300,
    ])
  })
})

describe('CHECKOUT_CLIENT_PRICING : rate card §2', () => {
  it('matches unfurnished × flex', () => {
    expect(CHECKOUT_CLIENT_PRICING.unfurnished.flex).toEqual([
      50, 60, 75, 90, 115, 130, 165, 175, 185, 195,
    ])
  })

  it('matches unfurnished × core', () => {
    expect(CHECKOUT_CLIENT_PRICING.unfurnished.core).toEqual([
      60, 80, 100, 120, 140, 160, 180, 200, 230, 250,
    ])
  })

  it('matches unfurnished × priority', () => {
    expect(CHECKOUT_CLIENT_PRICING.unfurnished.priority).toEqual([
      80, 100, 120, 140, 160, 180, 200, 230, 260, 280,
    ])
  })

  it('matches furnished × flex', () => {
    expect(CHECKOUT_CLIENT_PRICING.furnished.flex).toEqual([
      60, 70, 85, 105, 135, 150, 180, 200, 230, 250,
    ])
  })

  it('matches furnished × core', () => {
    expect(CHECKOUT_CLIENT_PRICING.furnished.core).toEqual([
      70, 90, 115, 135, 155, 180, 200, 220, 250, 270,
    ])
  })

  it('matches furnished × priority', () => {
    expect(CHECKOUT_CLIENT_PRICING.furnished.priority).toEqual([
      90, 110, 135, 155, 175, 200, 220, 250, 280, 300,
    ])
  })
})

describe('CHECKIN_PRICING : flat by size band', () => {
  it('Studio–2bed = £50, 3–5bed = £55, 6–9bed = £60', () => {
    expect(CHECKIN_PRICING).toEqual([50, 50, 50, 55, 55, 55, 60, 60, 60, 60])
  })
})

describe('MIDTERM_PRICING : flat £50 across all sizes', () => {
  it('is £50 for every band', () => {
    expect(MIDTERM_PRICING).toEqual([50, 50, 50, 50, 50, 50, 50, 50, 50, 50])
  })
})

describe('getServicePrice : part_furnished is the midpoint of unfurnished & furnished', () => {
  it('new_inventory 1-bed flex → round((70+80)/2) = 75', () => {
    expect(getServicePrice('new_inventory', '1_bed', 'flex', 'part_furnished')).toBe(75)
  })

  it('new_inventory 4-bed flex → round((120+140)/2) = 130', () => {
    expect(getServicePrice('new_inventory', '4_bed', 'flex', 'part_furnished')).toBe(130)
  })

  it('new_inventory 3-bed core (odd midpoint) → round((130+145)/2) = 138', () => {
    expect(getServicePrice('new_inventory', '3_bed', 'core', 'part_furnished')).toBe(138)
  })

  it('check_out studio priority → round((80+90)/2) = 85', () => {
    expect(getServicePrice('check_out', 'studio', 'priority', 'part_furnished')).toBe(85)
  })

  it('unfurnished ≤ part_furnished ≤ furnished for every tier/size (inventory + checkout)', () => {
    for (const service of ['new_inventory', 'check_out'] as const) {
      for (const tier of ['flex', 'core', 'priority'] as const) {
        for (const size of PROPERTY_SIZES) {
          const u = getServicePrice(service, size, tier, 'unfurnished')
          const p = getServicePrice(service, size, tier, 'part_furnished')
          const f = getServicePrice(service, size, tier, 'furnished')
          expect(p).toBeGreaterThanOrEqual(u)
          expect(p).toBeLessThanOrEqual(f)
        }
      }
    }
  })

  it('part_furnished is strictly cheaper than furnished wherever furnished > unfurnished', () => {
    for (const service of ['new_inventory', 'check_out'] as const) {
      for (const tier of ['flex', 'core', 'priority'] as const) {
        for (const size of PROPERTY_SIZES) {
          const u = getServicePrice(service, size, tier, 'unfurnished')
          const p = getServicePrice(service, size, tier, 'part_furnished')
          const f = getServicePrice(service, size, tier, 'furnished')
          if (f > u) expect(p).toBeLessThan(f)
        }
      }
    }
  })

  it('furnishing-agnostic services ignore part_furnished (check_in / mid_term)', () => {
    expect(getServicePrice('check_in', '2_bed', 'flex', 'part_furnished')).toBe(
      getServicePrice('check_in', '2_bed', 'flex', 'unfurnished')
    )
    expect(getServicePrice('mid_term', '5_bed', 'core', 'part_furnished')).toBe(
      getServicePrice('mid_term', '5_bed', 'core', 'unfurnished')
    )
  })
})

describe('CHECKOUT_CLERK_PAY / INVENTORY_CLERK_PAY : rate card clerk-pay column', () => {
  it('inventory clerk pay matches a sample of cells', () => {
    expect(INVENTORY_CLERK_PAY.unfurnished.flex).toEqual([22, 28, 35, 40, 45, 50, 56, 65, 72, 80])
    expect(INVENTORY_CLERK_PAY.furnished.priority).toEqual([32, 38, 42, 48, 52, 60, 70, 78, 85, 100])
  })
  it('checkout clerk pay matches a sample of cells', () => {
    expect(CHECKOUT_CLERK_PAY.unfurnished.flex).toEqual([20, 25, 30, 35, 40, 45, 50, 55, 60, 70])
    expect(CHECKOUT_CLERK_PAY.furnished.priority).toEqual([35, 40, 45, 50, 60, 65, 70, 75, 80, 85])
  })
  it('clerk pay is always less than the matching client price', () => {
    for (const t of ['flex', 'core', 'priority'] as const) {
      for (const f of ['unfurnished', 'furnished'] as const) {
        for (let i = 0; i < 10; i++) {
          expect(INVENTORY_CLERK_PAY[f][t][i]).toBeLessThan(INVENTORY_CLIENT_PRICING[f][t][i])
          expect(CHECKOUT_CLERK_PAY[f][t][i]).toBeLessThan(CHECKOUT_CLIENT_PRICING[f][t][i])
        }
      }
    }
  })
})

describe('computeClerkPayout', () => {
  it('inventory base payout = matrix cell when no features', () => {
    const { total } = computeClerkPayout(
      DEFAULT_PRICING, ['new_inventory'], '1_bed', 'core', 'unfurnished', NO_FEATURES
    )
    expect(total).toBe(32) // INVENTORY_CLERK_PAY.unfurnished.core[1]
  })

  it('part_furnished clerk pay is the midpoint', () => {
    // 1-bed core: unfurn 32, furn 35 → round(33.5) = 34
    expect(resolveClerkPay(DEFAULT_PRICING, 'new_inventory', '1_bed', 'core', 'part_furnished')).toBe(34)
  })

  it('check_in and interim use the flat add-on payout', () => {
    const checkIn = computeClerkPayout(
      DEFAULT_PRICING, ['check_in'], '2_bed', 'flex', 'unfurnished', NO_FEATURES
    )
    expect(checkIn.total).toBe(20)
    const interim = computeClerkPayout(
      DEFAULT_PRICING, ['mid_term'], '2_bed', 'flex', 'unfurnished', NO_FEATURES
    )
    expect(interim.total).toBe(25)
  })

  it('adds per-feature add-ons once and itemises them', () => {
    const { total, breakdown } = computeClerkPayout(
      DEFAULT_PRICING, ['new_inventory'], 'studio', 'flex', 'unfurnished',
      { bathrooms: 2, kitchens: 2, utilityRooms: 1, storageRooms: 1, hallwaysStairs: 1, gardens: 1, communalAreas: 0, heavilyFurnished: true }
    )
    // base 22 + kitchen 10 + bathroom 5 + utility/storage 2*5=10 + hallways 5 + garden 10 + heavily 15 = 77
    expect(total).toBe(77)
    expect(breakdown.find((l) => l.label === 'Additional kitchen')?.amount).toBe(10)
    expect(breakdown.find((l) => l.label === 'Heavily furnished')?.amount).toBe(15)
  })
})

describe('custom service types', () => {
  const fixed: CustomServiceType = {
    key: 'fire_safety_check',
    label: 'Fire Safety Check',
    baseModel: 'flat_fixed',
    requiresTenant: false,
    showInBooking: true,
    enabled: true,
    clientFixed: 45,
    clerkFixed: 18,
  }
  const bySize: CustomServiceType = {
    key: 'epc',
    label: 'EPC',
    baseModel: 'flat_size',
    requiresTenant: true,
    showInBooking: true,
    enabled: true,
    clientFlat: [10, 11, 12, 13, 14, 15, 16, 17, 18, 19],
    clerkFlat: [5, 5, 5, 5, 5, 5, 5, 5, 5, 5],
  }
  const hidden: CustomServiceType = {
    key: 'internal_audit',
    label: 'Internal Audit',
    baseModel: 'inventory',
    requiresTenant: false,
    showInBooking: false,
    enabled: true,
  }
  const disabled: CustomServiceType = { ...fixed, key: 'old_thing', enabled: false }
  const M: PricingMatrices = {
    ...DEFAULT_PRICING,
    customTypes: [fixed, bySize, hidden, disabled],
  }

  it('prices a flat_fixed custom type (client + clerk)', () => {
    expect(resolvePricing(M, 'fire_safety_check', '2_bed', 'core', 'unfurnished')).toBe(45)
    expect(resolveClerkPay(M, 'fire_safety_check', '2_bed', 'core', 'unfurnished')).toBe(18)
  })

  it('prices a flat_size custom type by size band', () => {
    expect(resolvePricing(M, 'epc', '1_bed', 'flex', 'unfurnished')).toBe(11)
    expect(resolveClerkPay(M, 'epc', '3_bed', 'flex', 'unfurnished')).toBe(5)
  })

  it('computeClerkPayout itemises a custom type by its label', () => {
    const out = computeClerkPayout(M, ['fire_safety_check'], 'studio', 'flex', 'unfurnished', NO_FEATURES)
    expect(out.total).toBe(18)
    expect(out.breakdown[0]?.label).toBe('Fire Safety Check')
  })

  it('getBookableServices includes enabled+visible custom types only', () => {
    const keys = getBookableServices(M).map((s) => s.key)
    expect(keys).toContain('fire_safety_check')
    expect(keys).toContain('epc')
    expect(keys).not.toContain('internal_audit') // showInBooking false
    expect(keys).not.toContain('old_thing') // disabled
    // built-ins still present
    expect(keys).toContain('new_inventory')
  })

  it('behaviour flags follow the type / base model', () => {
    expect(serviceRequiresTier('fire_safety_check', M.customTypes)).toBe(false)
    expect(serviceRequiresTier('internal_audit', M.customTypes)).toBe(true) // inventory-style
    expect(serviceRequiresTenant('epc', M.customTypes)).toBe(true)
    expect(serviceRequiresTenant('fire_safety_check', M.customTypes)).toBe(false)
  })

  it('serviceLabel resolves built-in, custom, and humanised fallback', () => {
    expect(serviceLabel('new_inventory')).toBe('New Inventory')
    expect(serviceLabel('fire_safety_check', M.customTypes)).toBe('Fire Safety Check')
    expect(serviceLabel('some_unknown_key')).toBe('Some Unknown Key')
  })
})

describe('matrix structural invariants', () => {
  const allMatrices = [
    ...Object.values(INVENTORY_CLIENT_PRICING).flatMap((tiers) =>
      Object.values(tiers)
    ),
    ...Object.values(CHECKOUT_CLIENT_PRICING).flatMap((tiers) =>
      Object.values(tiers)
    ),
    CHECKIN_PRICING,
    MIDTERM_PRICING,
  ]

  it('every matrix has exactly 10 entries (one per PROPERTY_SIZES band)', () => {
    for (const m of allMatrices) {
      expect(m.length).toBe(10)
    }
  })

  it('all prices are positive integers (no decimals, no zero, no negatives)', () => {
    for (const m of allMatrices) {
      for (const p of m) {
        expect(Number.isInteger(p)).toBe(true)
        expect(p).toBeGreaterThan(0)
      }
    }
  })

  it('within each tier, price is monotonically non-decreasing as property size grows', () => {
    for (const m of allMatrices) {
      for (let i = 1; i < m.length; i++) {
        expect(m[i]).toBeGreaterThanOrEqual(m[i - 1])
      }
    }
  })

  it('tiers price upward: flex ≤ core ≤ priority for each size band', () => {
    for (const matrix of [INVENTORY_CLIENT_PRICING, CHECKOUT_CLIENT_PRICING]) {
      for (const furnishing of ['unfurnished', 'furnished'] as const) {
        for (let i = 0; i < 10; i++) {
          expect(matrix[furnishing].flex[i]).toBeLessThanOrEqual(
            matrix[furnishing].core[i]
          )
          expect(matrix[furnishing].core[i]).toBeLessThanOrEqual(
            matrix[furnishing].priority[i]
          )
        }
      }
    }
  })

  it('furnished ≥ unfurnished at each (tier, size)', () => {
    for (const matrix of [INVENTORY_CLIENT_PRICING, CHECKOUT_CLIENT_PRICING]) {
      for (const tier of ['flex', 'core', 'priority'] as const) {
        for (let i = 0; i < 10; i++) {
          expect(matrix.furnished[tier][i]).toBeGreaterThanOrEqual(
            matrix.unfurnished[tier][i]
          )
        }
      }
    }
  })
})

describe('client add-ons (computeClientAddons)', () => {
  const a = DEFAULT_PRICING.clientAddons

  it('charges nothing for a single-of-each unfurnished property', () => {
    const { total, breakdown } = computeClientAddons(
      a,
      NO_CLIENT_FEATURES,
      'unfurnished'
    )
    expect(total).toBe(0)
    expect(breakdown).toHaveLength(0)
  })

  it('adds the part-furnished furnishing adder (£5 default)', () => {
    const { total } = computeClientAddons(a, NO_CLIENT_FEATURES, 'part_furnished')
    expect(total).toBe(a.furnishingPartFurnished)
  })

  it('adds the furnished adder (£10 default)', () => {
    const { total } = computeClientAddons(a, NO_CLIENT_FEATURES, 'furnished')
    expect(total).toBe(a.furnishingFurnished)
  })

  it('charges £5 per room above the included-free baseline', () => {
    // 2 bed / 2 bath / 2 living / 2 dining (1 free each) = 4 extras × £5.
    const features: ClientPropertyFeatures = {
      bedrooms: 2,
      bathrooms: 2,
      livingRooms: 2,
      diningAreas: 2,
      kitchens: 1,
      gardens: 0,
      communalAreas: 0,
      hallwaysStairs: 0,
      utilityRooms: 0,
      storageRooms: 0,
    }
    const { total } = computeClientAddons(a, features, 'unfurnished')
    expect(total).toBe(4 * 5)
  })

  it('charges per-unit for hallways, utility and storage (free 0)', () => {
    const features: ClientPropertyFeatures = {
      ...NO_CLIENT_FEATURES,
      hallwaysStairs: 2,
      utilityRooms: 1,
      storageRooms: 3,
    }
    const { total } = computeClientAddons(a, features, 'unfurnished')
    expect(total).toBe(
      2 * a.perHallwaysStairs + 1 * a.perUtilityRoom + 3 * a.perStorageRoom
    )
  })

  it('charges gardens from the first at £20', () => {
    const features: ClientPropertyFeatures = {
      ...NO_CLIENT_FEATURES,
      gardens: 2,
    }
    const { total } = computeClientAddons(a, features, 'unfurnished')
    expect(total).toBe(2 * a.perGarden)
  })
})

describe('client price (computeClientPrice)', () => {
  it('subtotal = base(unfurnished) + furnishing adder + room add-ons', () => {
    // 1-bed core inventory + check-in, part-furnished, 2 gardens.
    const size = '1_bed' as const
    const tier = 'core' as const
    const features: ClientPropertyFeatures = {
      ...NO_CLIENT_FEATURES,
      gardens: 2,
    }
    const b = computeClientPrice(DEFAULT_PRICING, {
      services: ['new_inventory', 'check_in'],
      size,
      tier,
      furnishing: 'part_furnished',
      features,
    })
    const expectedBase =
      resolveServiceBase(DEFAULT_PRICING, 'new_inventory', size, tier) +
      resolveServiceBase(DEFAULT_PRICING, 'check_in', size, tier)
    const expectedAddons = computeClientAddons(
      DEFAULT_PRICING.clientAddons,
      features,
      'part_furnished'
    ).total
    expect(b.servicesTotal).toBe(expectedBase)
    expect(b.addonsTotal).toBe(expectedAddons)
    expect(b.subtotal).toBe(expectedBase + expectedAddons)
  })

  it('base price ignores furnishing (it is added separately)', () => {
    const size = '2_bed' as const
    const tier = 'flex' as const
    const unf = resolveServiceBase(DEFAULT_PRICING, 'new_inventory', size, tier)
    // resolveServiceBase must equal the unfurnished matrix value, NOT the
    // furnished/part-furnished one — else furnishing would double-count.
    expect(unf).toBe(
      resolvePricing(DEFAULT_PRICING, 'new_inventory', size, tier, 'unfurnished')
    )
  })

  it('does not double-charge bedrooms already covered by the size band', () => {
    // A 2-bed booking's base price IS the 2-bedroom price — a property with
    // 2 bedrooms must add NO "Extra bedroom" line (the historical bug).
    const features: ClientPropertyFeatures = {
      ...NO_CLIENT_FEATURES,
      bedrooms: 2,
    }
    const b = computeClientPrice(DEFAULT_PRICING, {
      services: ['new_inventory'],
      size: '2_bed',
      tier: 'core',
      furnishing: 'unfurnished',
      features,
    })
    expect(b.addons.find((l) => l.label.startsWith('Extra bedroom'))).toBeUndefined()
    expect(b.addonsTotal).toBe(0)
  })

  it('platform fee grosses up the card cost (1.5% + 20p) and is 0 for £0', () => {
    // (100 + 0.20) / (1 - 0.015) - 100 = 1.7259… → £1.73
    expect(computePlatformFee(100)).toBe(1.73)
    expect(computePlatformFee(0)).toBe(0)
    // Verify the gross-up actually covers Stripe's cut: after Stripe takes
    // 1.5% + 20p of the grossed total, at least the base amount remains.
    const base = 85
    const total = base + computePlatformFee(base)
    expect(total - (total * 0.015 + 0.2)).toBeGreaterThanOrEqual(base - 0.01)
  })

  it('charges only bedrooms beyond the size band', () => {
    // 4 bedrooms on a 3-bed booking → exactly 1 extra bedroom billed.
    const features: ClientPropertyFeatures = {
      ...NO_CLIENT_FEATURES,
      bedrooms: 4,
    }
    const b = computeClientPrice(DEFAULT_PRICING, {
      services: ['new_inventory'],
      size: '3_bed',
      tier: 'core',
      furnishing: 'unfurnished',
      features,
    })
    const line = b.addons.find((l) => l.label.startsWith('Extra bedroom'))
    expect(line?.amount).toBe(DEFAULT_PRICING.clientAddons.perBedroom)
  })
})

describe('cleaning service pricing', () => {
  const C = DEFAULT_PRICING.cleaning

  it('resolves the property-manager (client) flat price by level + size', () => {
    expect(resolveCleaningClientPrice(C, 'light', 'studio')).toBe(35)
    expect(resolveCleaningClientPrice(C, 'light', '2_bed')).toBe(75)
    expect(resolveCleaningClientPrice(C, 'general', '1_bed')).toBe(125)
    expect(resolveCleaningClientPrice(C, 'deep', '3_bed')).toBe(295)
  })

  it('fills 7bed+ across bands 7/8/9, and Deep splits 7 vs 8+', () => {
    // Light "7bed+" = 200 for 7, 8 and 9.
    expect(resolveCleaningClientPrice(C, 'light', '7_bed')).toBe(200)
    expect(resolveCleaningClientPrice(C, 'light', '9_bed')).toBe(200)
    // Deep splits: 7 = 650, 8+ = 800.
    expect(resolveCleaningClientPrice(C, 'deep', '7_bed')).toBe(650)
    expect(resolveCleaningClientPrice(C, 'deep', '8_bed')).toBe(800)
    expect(resolveCleaningClientPrice(C, 'deep', '9_bed')).toBe(800)
  })

  it('cleaner pay = hourly rate × max-hours cap', () => {
    // 2-bed light = £16/h × 1.5h = £24.
    expect(resolveCleaningCleanerPay(C, 'light', '2_bed')).toEqual({
      hourlyRate: 16,
      maxHours: 1.5,
      total: 24,
    })
    // 5-bed general = £23/h × 4h = £92.
    expect(resolveCleaningCleanerPay(C, 'general', '5_bed').total).toBe(92)
    // 3-bed deep = £23/h × 3.5h = £80.50 (decimal hours).
    expect(resolveCleaningCleanerPay(C, 'deep', '3_bed').total).toBe(80.5)
  })

  it('maps clean levels to/from the jobs.inspection_type key', () => {
    expect(CLEAN_TYPE_KEYS.light).toBe('clean_light')
    expect(cleanLevelFromType('clean_general')).toBe('general')
    expect(cleanLevelFromType('clean_deep')).toBe('deep')
    expect(cleanLevelFromType('new_inventory')).toBeNull()
  })

  it('unknown size resolves to 0 / zero pay, never throws', () => {
    expect(
      resolveCleaningClientPrice(C, 'light', 'mansion' as never)
    ).toBe(0)
    expect(resolveCleaningCleanerPay(C, 'deep', 'mansion' as never)).toEqual({
      hourlyRate: 0,
      maxHours: 0,
      total: 0,
    })
  })
})
