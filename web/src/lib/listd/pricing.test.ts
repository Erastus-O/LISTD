import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PRICING as pr,
  addWorkDays,
  contribution,
  coverageBlock,
  feeFromBase,
  feeParts,
  linesTotal,
  mergePricing,
  portfolioLine,
  portfolioSummary,
  priceCleaning,
  priceDiagnosis,
  priceInspection,
  repairProFee,
  schedForDate,
  workDaysUntil,
  type InspectionKey,
  type PricedJob,
  type PricedProperty,
} from './pricing'

const flat = (over: Partial<PricedProperty> = {}): PricedProperty => ({
  bedrooms: 2,
  bathrooms: 1,
  kitchens: 1,
  extraReceptions: 0,
  furnishing: 'unfurnished',
  ...over,
})

const total = (key: InspectionKey, p: PricedProperty, o = {}) =>
  linesTotal((priceInspection(pr, key, p, o) as PricedJob).lines)

describe('inspection rate card matches the website', () => {
  // Rows of the table on the Pricing page: studio to 4 bedrooms, in pence.
  const table: Record<InspectionKey, number[]> = {
    INVENTORY: [8500, 10000, 12000, 14000, 16000],
    CHECK_IN: [6000, 6000, 6500, 7000, 7500],
    MID_TERM: [6000, 6500, 7500, 8500, 9500],
    CHECK_OUT: [7500, 9000, 11000, 13000, 15000],
  }
  for (const [key, row] of Object.entries(table) as Array<[InspectionKey, number[]]>) {
    row.forEach((price, beds) => {
      it(`${key} ${beds} bed = ${price}`, () => {
        expect(total(key, flat({ bedrooms: beds }))).toBe(price)
      })
    })
  }

  it('same visit: inventory + check-in equals the combo price, as two positive lines', () => {
    const inv = priceInspection(pr, 'INVENTORY', flat(), { combo: true }) as PricedJob
    const ci = priceInspection(pr, 'CHECK_IN', flat(), { combo: true }) as PricedJob
    expect(linesTotal(inv.lines) + linesTotal(ci.lines)).toBe(14500)
    expect([...inv.lines, ...ci.lines].every((l) => l.u > 0)).toBe(true)
  })

  it('worked example: two-bed furnished flat is £165, or £195 with Priority', () => {
    const p = flat({ furnishing: 'furnished' })
    const sum = (sched?: 'priority') =>
      linesTotal((priceInspection(pr, 'INVENTORY', p, { combo: true, sched }) as PricedJob).lines) +
      linesTotal((priceInspection(pr, 'CHECK_IN', p, { combo: true, sched }) as PricedJob).lines)
    expect(sum()).toBe(16500)
    expect(sum('priority')).toBe(19500)
  })

  it('furnishing is charged once: part +£10, furnished +£20 or +£30 from 3 beds', () => {
    expect(total('CHECK_OUT', flat({ furnishing: 'part' }))).toBe(11000 + 1000)
    expect(total('CHECK_OUT', flat({ furnishing: 'furnished' }))).toBe(11000 + 2000)
    expect(total('CHECK_OUT', flat({ bedrooms: 3, furnishing: 'furnished' }))).toBe(13000 + 3000)
  })

  it('every extra room is its own £10 line; outbuildings and outdoor are £15', () => {
    const r = priceInspection(pr, 'INVENTORY', flat({ bathrooms: 3, kitchens: 2, extraReceptions: 1, outbuildings: true, outdoor: true })) as PricedJob
    expect(r.lines.filter((l) => l.u === 1000).map((l) => l.d)).toEqual([
      'Extra bathroom 1',
      'Extra bathroom 2',
      'Extra kitchen',
      'Extra reception room',
    ])
    expect(linesTotal(r.lines)).toBe(12000 + 4000 + 3000)
  })

  it('goes to a custom quote for 5+ beds, heavy furnishing or an unusual floor area', () => {
    expect(priceInspection(pr, 'INVENTORY', flat({ bedrooms: 5 }))).toHaveProperty('custom')
    expect(priceInspection(pr, 'INVENTORY', flat({ furnishing: 'heavy' }))).toHaveProperty('custom')
    expect(priceInspection(pr, 'INVENTORY', flat({ areaM2: 500 }))).toHaveProperty('custom')
  })
})

describe('Priority is decided by the date, in working days', () => {
  // Monday 2 Nov 2026.
  const monday = '2026-11-02'
  it('counts Mon to Fri only', () => {
    expect(addWorkDays('2026-11-06', 1)).toBe('2026-11-09')
    expect(workDaysUntil('2026-11-09', '2026-11-06')).toBe(1)
  })
  it('within two working days is Priority, later is Standard', () => {
    expect(schedForDate(pr, '2026-11-04', monday)).toBe('priority')
    expect(schedForDate(pr, '2026-11-05', monday)).toBe('standard')
  })
  it('adds £30 to the client and £20 to the Pro', () => {
    const std = priceInspection(pr, 'CHECK_OUT', flat(), { sched: 'standard' }) as PricedJob
    const pri = priceInspection(pr, 'CHECK_OUT', flat(), { sched: 'priority' }) as PricedJob
    expect(linesTotal(pri.lines) - linesTotal(std.lines)).toBe(3000)
    expect(feeFromBase(pr, pri.proBase) - feeFromBase(pr, std.proBase)).toBe(2000)
  })
})

describe('Pro fees come from workload and level', () => {
  const base = (priceInspection(pr, 'INVENTORY', flat()) as PricedJob).proBase

  it('needs the right level for the size', () => {
    expect(base.level).toBe(1)
    expect((priceInspection(pr, 'INVENTORY', flat({ bedrooms: 3 })) as PricedJob).proBase.level).toBe(2)
  })
  it('a higher level earns more for the same job', () => {
    expect(feeFromBase(pr, base, 3)).toBeGreaterThan(feeFromBase(pr, base, 1))
  })
  it('rounds to the nearest 50p', () => {
    for (const lv of [1, 2, 3]) expect(feeFromBase(pr, base, lv) % 50).toBe(0)
  })
  it('itemised parts add up to the fee', () => {
    for (const lv of [1, 2, 3]) {
      expect(feeParts(pr, base, lv).reduce((a, x) => a + x[1], 0)).toBe(feeFromBase(pr, base, lv))
    }
  })
})

describe('cleaning', () => {
  it('gives a ±15% estimate around the price, in £5 steps', () => {
    const c = priceCleaning(pr, flat(), { clean: 'standard' })
    const sub = linesTotal(c.lines)
    expect(c.estLowP).toBeLessThanOrEqual(sub)
    expect(c.estHighP).toBeGreaterThanOrEqual(sub)
    expect(c.estLowP % 500).toBe(0)
  })
  it('sets the level by clean type', () => {
    expect(priceCleaning(pr, flat(), { clean: 'standard' }).proBase.level).toBe(1)
    expect(priceCleaning(pr, flat(), { clean: 'eot' }).proBase.level).toBe(2)
    expect(priceCleaning(pr, flat(), { clean: 'office' }).proBase.level).toBe(2)
    expect(priceCleaning(pr, flat(), { clean: 'deep' }).proBase.level).toBe(3)
  })
  it('does not charge add-ons a deep clean already includes', () => {
    const d = priceCleaning(pr, flat(), { clean: 'deep', addons: ['oven', 'carpets'], carpetRooms: 2 })
    expect(d.lines.some((l) => l.d === 'Oven clean')).toBe(false)
    expect(d.lines.find((l) => l.d.startsWith('Carpet'))?.q).toBe(2)
  })
  it('applies the minimum booking', () => {
    const s = priceCleaning(pr, flat({ bedrooms: 0 }), { clean: 'deep' })
    expect(s.lines[0].u).toBeGreaterThanOrEqual(pr.clean.minP.deep)
  })
  it('sends office cleans and exterior windows to LISTD for a quote', () => {
    expect(priceCleaning(pr, flat(), { clean: 'office' }).needsReview).toBe(true)
    expect(priceCleaning(pr, flat(), { clean: 'standard', addons: ['windowsOut'] }).needsReview).toBe(true)
    expect(priceCleaning(pr, flat(), { clean: 'standard' }).needsReview).toBe(false)
  })
})

describe('repairs', () => {
  it('diagnosis is £50, with £25 to the Pro', () => {
    const d = priceDiagnosis(pr)
    expect(linesTotal(d.lines)).toBe(5000)
    expect(d.proFeeP).toBe(2500)
  })
  it('Pro fee is a labour share plus materials at cost', () => {
    expect(
      repairProFee(pr, [
        { d: 'Labour', q: 1, u: 10000, tag: 'svc' },
        { d: 'Materials', q: 1, u: 2000, tag: 'materials' },
      ])
    ).toBe(7500 + 2000)
  })
})

describe('contribution floor and portfolio', () => {
  it('floor is £25 or 25% of revenue, whichever is higher', () => {
    expect(contribution(pr, 10000, 0).floorP).toBe(2500)
    expect(contribution(pr, 20000, 0).floorP).toBe(5000)
  })
  it('tiers: under 10 standard, 10 to 24 rebate, 25+ negotiated', () => {
    const job = { lines: [{ d: 'x', q: 1, u: 12000, tag: 'svc' as const }], revP: 12000, proP: 5000 }
    expect(portfolioSummary(pr, Array(9).fill(job)).tier).toBe('standard')
    expect(portfolioSummary(pr, Array(10).fill(job)).tier).toBe('rebate')
    expect(portfolioSummary(pr, Array(25).fill(job)).tier).toBe('negotiated')
  })
  it('rebate is 5% of eligible fees, excluding Priority and materials', () => {
    const job = {
      lines: [
        { d: 'Service', q: 1, u: 10000, tag: 'svc' as const },
        { d: 'Priority', q: 1, u: 3000, tag: 'urgency' as const },
        { d: 'Materials', q: 1, u: 2000, tag: 'materials' as const },
      ],
      revP: 15000,
      proP: 3000,
    }
    const s = portfolioSummary(pr, Array(10).fill(job))
    expect(s.eligibleP).toBe(100000)
    expect(s.rebateP).toBe(5000)
  })
  it('rebate never takes a job below the floor', () => {
    const thin = { lines: [{ d: 'x', q: 1, u: 10000, tag: 'svc' as const }], revP: 10000, proP: 7000 }
    expect(portfolioSummary(pr, Array(10).fill(thin)).rebateP).toBe(0)
  })
  it('negotiated line is a negative service adjustment, capped by the floor', () => {
    const lines = [{ d: 'x', q: 1, u: 12000, tag: 'svc' as const }]
    const l = portfolioLine(pr, 10, lines, 5000)
    expect(l?.u).toBe(-1200)
    expect(portfolioLine(pr, 10, lines, 8500)).toBeNull()
  })
})

describe('coverage', () => {
  it('allows every service at any UK postcode', () => {
    for (const pc of ['BS8 1TH', 'ex1 1aa', 'B12 9AA', 'M1 1AA', 'SW1A 1AA', 'E1 6AN', 'N1C 4AG', 'EC1A 1BB', 'W1D 3QF', 'G2 1DY', 'CF10 1EP', 'BT1 5GS', 'se228jx']) {
      expect(coverageBlock(pc, 'CHECK_OUT', 'Check-Out')).toBeNull()
      expect(coverageBlock(pc, 'CLEANING', 'Cleaning')).toBeNull()
    }
  })
  it('refuses a missing or incomplete postcode', () => {
    for (const pc of [null, '', 'SW1', 'BS8', '12345', 'not a postcode']) {
      expect(coverageBlock(pc, 'CHECK_OUT', 'Check-Out')).toMatch(/full UK postcode/)
    }
  })
})

describe('admin overrides', () => {
  it('merge per section, keeping other defaults', () => {
    const m = mergePricing({ sched: { priorityP: 4000 } })
    expect(m.sched.priorityP).toBe(4000)
    expect(m.sched.priorityDays).toBe(2)
    expect(m.rates.INVENTORY[2]).toBe(12000)
  })
})
