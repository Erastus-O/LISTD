/**
 * LISTD pricing engine, ported from the client's prototype (platform/src/pricing.js).
 *
 * One service standard: clients pay for the service, its complexity once and
 * urgency separately. Inspections are a fixed rate card by size. Cleaning is an
 * estimate, then a fixed quote. Repairs are a fixed task price or a paid
 * diagnosis. Pro pay comes from workload, and the selling price is checked
 * against a contribution floor.
 *
 * All money is integer pence. Pure functions only: settings are passed in, so
 * this is safe to use from the browser (price preview) and the server.
 * Figures are editable pilot prices; defaults live here, overrides in
 * platform_settings (see pricing-settings.ts).
 */

export type ServiceKey = 'INVENTORY' | 'CHECK_IN' | 'MID_TERM' | 'CHECK_OUT' | 'CLEANING' | 'REPAIRS_DAMAGES'
export type InspectionKey = 'INVENTORY' | 'CHECK_IN' | 'MID_TERM' | 'CHECK_OUT'
export type ProRole = 'CLERK' | 'CLEANER' | 'TRADES'
export type Sched = 'standard' | 'priority'
export type Furnishing = 'unfurnished' | 'part' | 'furnished' | 'heavy'
export type CleanType = 'standard' | 'deep' | 'eot' | 'office'
export type CleanAddon = 'oven' | 'fridge' | 'cupboards' | 'carpets' | 'windowsOut'
export type CleanCondition = 'vacant-tidy' | 'vacant-dirty' | 'occupied'
export type LineTag = 'svc' | 'urgency' | 'materials' | 'credit' | 'portfolio'

export type QuoteLine = { d: string; q: number; u: number; tag: LineTag }

/** What a Pro's fee is built from; the fee itself depends on who accepts. */
export type ProBase = {
  role: ProRole
  /** The level the workload was priced at (the minimum level for the job). */
  level: number
  attendP: number
  kitOnly?: boolean
  minutes: number
  allowP: number
  allow: Array<[string, number]>
}

export type PricedProperty = {
  bedrooms: number
  bathrooms: number
  kitchens: number
  /** Reception rooms beyond the one living room the size price includes. */
  extraReceptions: number
  furnishing: Furnishing
  areaM2?: number | null
  outbuildings?: boolean
  outdoor?: boolean
}

export const SIZE_LABEL = ['Studio', '1 bedroom', '2 bedrooms', '3 bedrooms', '4 bedrooms']

export const FURNISH_LABEL: Record<Furnishing, string> = {
  unfurnished: 'Unfurnished',
  part: 'Part-furnished',
  furnished: 'Normally furnished',
  heavy: 'Heavily furnished or very detailed',
}

export const INSPECTION_LABEL: Record<InspectionKey, string> = {
  INVENTORY: 'Inventory & Condition',
  CHECK_IN: 'Check-in handover',
  MID_TERM: 'Mid-term inspection',
  CHECK_OUT: 'Check-out',
}

export const CLEAN_LABEL: Record<CleanType, string> = {
  standard: 'Standard Home Cleaning',
  deep: 'Deep Cleaning',
  eot: 'End of Tenancy Cleaning',
  office: 'Office Cleaning',
}

export const CLEAN_ADDON_LABEL: Record<CleanAddon, string> = {
  oven: 'Oven clean',
  fridge: 'Fridge and freezer inside',
  cupboards: 'Inside cupboards',
  carpets: 'Carpet clean (per room)',
  windowsOut: 'Exterior windows',
}

export const DEFAULT_PRICING = {
  area: 'Bristol and Birmingham',
  rates: {
    INVENTORY: [8500, 10000, 12000, 14000, 16000],
    CHECK_IN: [6000, 6000, 6500, 7000, 7500],
    COMBO: [11000, 12500, 14500, 16500, 18500],
    CHECK_OUT: [7500, 9000, 11000, 13000, 15000],
    MID_TERM: [6000, 6500, 7500, 8500, 9500],
  },
  furnish: { part: 1000, furnishedSmall: 2000, furnishedLarge: 3000 },
  extraRoomP: 1000,
  outbuildingP: 1500,
  outdoorP: 1500,
  sched: { priorityP: 3000, priorityProP: 2000, priorityDays: 2, priorityOpen: true },
  floor: { minP: 2500, pct: 25 },
  costs: { payPct: 1.5, payFixedP: 20, opsP: 500, reworkPct: 3 },
  pro: {
    attendP: 1000,
    furnishSharePct: 50,
    // Hourly rate per role and level (1, 2, 3), set by LISTD.
    rates: {
      CLERK: [1800, 2000, 2200],
      CLEANER: [1400, 1500, 1600],
      TRADES: [2000, 2300, 2600],
    } as Record<ProRole, number[]>,
    // [base minutes, minutes per bedroom]
    minutes: {
      INVENTORY: [75, 30],
      CHECK_IN: [45, 5],
      CHECK_IN_COMBO: [40, 5],
      MID_TERM: [45, 10],
      CHECK_OUT: [65, 25],
    } as Record<string, [number, number]>,
  },
  clean: {
    hourP: 2600,
    consumablesP: 800,
    kitP: 500,
    spreadPct: 15,
    // [base hours, hours per bedroom, hours per extra bathroom]
    hours: {
      standard: [1.5, 0.75, 0.5],
      deep: [3, 1.5, 1],
      eot: [3.5, 1.5, 1],
    } as Record<string, [number, number, number]>,
    officeM2PerHour: 60,
    officeMinH: 2,
    cond: { 'vacant-tidy': 1, 'vacant-dirty': 1.25, occupied: 1.1 } as Record<string, number>,
    minP: { standard: 6000, deep: 11000, eot: 12000, office: 6000 } as Record<string, number>,
    addons: { oven: 3500, fridge: 1500, cupboards: 2000, carpets: 2500 } as Record<string, number>,
    addonH: { oven: 1, fridge: 0.5, cupboards: 0.75, carpets: 0.75 } as Record<string, number>,
  },
  repairs: { diagnosisP: 5000, diagnosisProP: 2500, labourProPct: 75 },
  rebate: { tier1: 10, pct: 5, tier2: 25 },
  taxPct: 0,
  quoteValidityDays: 7,
  reviewHours: 48,
}

export type Pricing = typeof DEFAULT_PRICING

/** Shallow-per-section merge of admin overrides over the defaults. */
export function mergePricing(overrides: Partial<Record<keyof Pricing, unknown>> | null | undefined): Pricing {
  const out = { ...DEFAULT_PRICING } as Record<string, unknown>
  for (const [key, value] of Object.entries(overrides ?? {})) {
    if (value == null || !(key in DEFAULT_PRICING)) continue
    const base = (DEFAULT_PRICING as Record<string, unknown>)[key]
    out[key] =
      typeof base === 'object' && !Array.isArray(base)
        ? { ...(base as object), ...(value as object) }
        : value
  }
  return out as Pricing
}

const line = (d: string, u: number, tag: LineTag = 'svc', q = 1): QuoteLine => ({ d, q, u: Math.round(u), tag })

export function sizeIndex(bedrooms: number): number {
  const beds = Math.max(0, Math.round(Number(bedrooms) || 0))
  return beds >= 5 ? -1 : beds
}

/* ---- dates: working days are Mon to Fri ---- */

const parseDay = (iso: string) => new Date(`${iso}T12:00:00Z`)
const isWorkDay = (d: Date) => d.getUTCDay() % 6 !== 0

export function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export function addWorkDays(from: string, n: number): string {
  const d = parseDay(from)
  let left = n
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1)
    if (isWorkDay(d)) left--
  }
  return isoDay(d)
}

export function workDaysUntil(date: string, from: string): number {
  const a = parseDay(from)
  const b = parseDay(date)
  let n = 0
  while (a < b) {
    a.setUTCDate(a.getUTCDate() + 1)
    if (isWorkDay(a)) n++
  }
  return n
}

/** The date decides: within priorityDays working days is Priority, later is Standard. */
export function schedForDate(pr: Pricing, date: string, today: string): Sched {
  return workDaysUntil(date, today) <= pr.sched.priorityDays ? 'priority' : 'standard'
}

/** Null when the date can be booked, otherwise the reason it can't. */
export function dateBlock(pr: Pricing, date: string, today: string): string | null {
  if (date <= today) return 'Choose a date after today.'
  if (schedForDate(pr, date, today) === 'priority' && !pr.sched.priorityOpen) {
    return `Priority isn’t available right now. Choose a date more than ${pr.sched.priorityDays} working days ahead.`
  }
  return null
}

function schedLine(pr: Pricing, sched: Sched | undefined): QuoteLine | null {
  return sched === 'priority'
    ? line(`Priority appointment (within ${pr.sched.priorityDays} working days)`, pr.sched.priorityP, 'urgency')
    : null
}

function furnishAdj(pr: Pricing, f: Furnishing, beds: number): number {
  if (f === 'part') return pr.furnish.part
  if (f === 'furnished') return beds >= 3 ? pr.furnish.furnishedLarge : pr.furnish.furnishedSmall
  return 0
}

/** Much larger than the bedroom count suggests: LISTD reviews before pricing. */
function areaUnusual(p: PricedProperty): boolean {
  const a = Number(p.areaM2) || 0
  return a > 0 && a > (40 + 30 * Math.max(0, p.bedrooms)) * 1.5
}

/* ---- Pro pay ---- */

export function proRate(pr: Pricing, role: ProRole, level: number): number {
  const rates = pr.pro.rates[role] ?? DEFAULT_PRICING.pro.rates[role]
  return rates[Math.min(3, Math.max(1, level || 1)) - 1]
}

/** Fee for a Pro at `level`, rounded to the nearest 50p. */
export function feeFromBase(pr: Pricing, base: ProBase, level?: number): number {
  const rate = proRate(pr, base.role, level ?? base.level)
  return Math.round((base.attendP + (base.minutes / 60) * rate + base.allowP) / 50) * 50
}

/** How a fee is built, line by line, for the Pro and for LISTD. */
export function feeParts(pr: Pricing, base: ProBase, level?: number): Array<[string, number]> {
  const lv = level ?? base.level
  const rate = proRate(pr, base.role, lv)
  const out: Array<[string, number]> = []
  if (base.attendP) out.push([base.kitOnly ? 'Kit allowance' : 'Attendance allowance', base.attendP])
  if (base.minutes) {
    const h = Math.floor(base.minutes / 60)
    const m = base.minutes % 60
    const dur = `${h ? `${h}h ` : ''}${m ? `${m}m` : ''}`.trim()
    out.push([`Expected time: ${dur} at £${(rate / 100).toFixed(2)}/h (Level ${lv})`, Math.round((base.minutes / 60) * rate)])
  }
  out.push(...base.allow)
  const sum = out.reduce((a, x) => a + x[1], 0)
  const fee = feeFromBase(pr, base, lv)
  if (fee !== sum) out.push(['Rounding to the nearest 50p', fee - sum])
  return out
}

/* ---- inspections ---- */

export type PricedJob = {
  lines: QuoteLine[]
  proBase: ProBase
  durationMin: number
}

export type CustomQuote = { custom: string }

export function priceInspection(
  pr: Pricing,
  key: InspectionKey,
  p: PricedProperty,
  o: { combo?: boolean; sched?: Sched } = {}
): PricedJob | CustomQuote {
  const beds = Number(p.bedrooms) || 0
  const i = sizeIndex(beds)
  const why: string[] = []
  if (i < 0) why.push('5+ bedrooms are quoted individually')
  if (p.furnishing === 'heavy') why.push('heavily furnished or very detailed inventories are quoted individually')
  if (areaUnusual(p)) why.push('the floor area is large for the bedroom count, so LISTD reviews it first')
  if (why.length) return { custom: why.join('; ') }

  // Same visit: the combined price is two positive lines, never a discount line.
  const comboInventory = o.combo && key === 'INVENTORY'
  const comboCheckIn = o.combo && key === 'CHECK_IN'
  const label = INSPECTION_LABEL[key]
  const lines: QuoteLine[] = []
  if (comboInventory) {
    lines.push(
      line(
        `${label} · ${SIZE_LABEL[i]} · same visit as the check-in (Inventory + Check-in £${pr.rates.COMBO[i] / 100} together)`,
        pr.rates.COMBO[i] - pr.rates.CHECK_IN[i]
      )
    )
  } else if (comboCheckIn) {
    lines.push(line(`${label} · ${SIZE_LABEL[i]} · same visit as the inventory`, pr.rates.CHECK_IN[i]))
  } else {
    lines.push(line(`${label} · ${SIZE_LABEL[i]}`, pr.rates[key][i]))
  }

  let allow = 0
  const allowItems: Array<[string, number]> = []
  // Furnishing, extras and Priority sit on the inventory when booked together.
  if (!comboCheckIn) {
    const fa = furnishAdj(pr, p.furnishing, beds)
    if (fa) {
      lines.push(line(`Furnishing: ${FURNISH_LABEL[p.furnishing].toLowerCase()}`, fa))
      const share = (fa * pr.pro.furnishSharePct) / 100
      allow += share
      allowItems.push([`Furnishing allowance (${FURNISH_LABEL[p.furnishing].toLowerCase()})`, Math.round(share)])
    }
    const extras: Array<[string, number]> = [
      ['Extra bathroom', Math.max(0, (p.bathrooms || 1) - 1)],
      ['Extra kitchen', Math.max(0, (p.kitchens || 1) - 1)],
      ['Extra reception room', Math.max(0, p.extraReceptions || 0)],
    ]
    const extraCount = extras.reduce((a, x) => a + x[1], 0)
    for (const [name, n] of extras) {
      for (let e = 1; e <= n; e++) lines.push(line(`${name}${n > 1 ? ` ${e}` : ''}`, pr.extraRoomP))
    }
    if (extraCount) {
      allow += (extraCount * pr.extraRoomP) / 2
      allowItems.push([`Extra rooms allowance (${extraCount})`, Math.round((extraCount * pr.extraRoomP) / 2)])
    }
    if (p.outbuildings) {
      lines.push(line('Outbuildings', pr.outbuildingP))
      allow += pr.outbuildingP / 2
      allowItems.push(['Outbuildings allowance', Math.round(pr.outbuildingP / 2)])
    }
    if (p.outdoor) {
      lines.push(line('Large outdoor area', pr.outdoorP))
      allow += pr.outdoorP / 2
      allowItems.push(['Outdoor areas allowance', Math.round(pr.outdoorP / 2)])
    }
    const sl = schedLine(pr, o.sched)
    if (sl) {
      lines.push(sl)
      allow += pr.sched.priorityProP
      allowItems.push(['Priority allowance', pr.sched.priorityProP])
    }
  }

  const [mBase, mBed] = pr.pro.minutes[comboCheckIn ? 'CHECK_IN_COMBO' : key] ?? [60, 10]
  const minutes = mBase + mBed * Math.max(0, beds)
  return {
    lines,
    proBase: {
      role: 'CLERK',
      level: beds <= 2 ? 1 : beds <= 4 ? 2 : 3,
      attendP: comboCheckIn ? 0 : pr.pro.attendP,
      minutes,
      allowP: Math.round(allow),
      allow: allowItems,
    },
    durationMin: Math.round(minutes / 15) * 15,
  }
}

/* ---- cleaning: an estimate, then a fixed approved quote ---- */

export type CleanScope = {
  clean: CleanType
  condition?: CleanCondition
  addons?: CleanAddon[]
  carpetRooms?: number
  areaM2?: number
}

const CLEAN_INCLUDES: Record<CleanType, CleanAddon[]> = {
  standard: [],
  deep: ['oven', 'fridge', 'cupboards'],
  eot: ['oven', 'fridge', 'cupboards'],
  office: [],
}

export function cleanHours(pr: Pricing, p: PricedProperty, sc: CleanScope): number {
  const c = pr.clean
  let h: number
  if (sc.clean === 'office') {
    h = Math.max(c.officeMinH, (sc.areaM2 || p.areaM2 || 120) / c.officeM2PerHour)
  } else {
    const [base, bed, bath] = c.hours[sc.clean] ?? c.hours.standard
    h = base + bed * Math.max(0, p.bedrooms) + bath * Math.max(0, (p.bathrooms || 1) - 1)
    h *= c.cond[sc.condition ?? 'vacant-tidy'] ?? 1
  }
  for (const a of sc.addons ?? []) {
    if (c.addonH[a] && !CLEAN_INCLUDES[sc.clean].includes(a)) {
      h += c.addonH[a] * (a === 'carpets' ? Math.max(1, sc.carpetRooms || 1) : 1)
    }
  }
  return Math.round(h * 4) / 4
}

export function priceCleaning(pr: Pricing, p: PricedProperty, sc: CleanScope, o: { sched?: Sched } = {}) {
  const c = pr.clean
  const h = cleanHours(pr, p, sc)
  const labour = Math.max(c.minP[sc.clean] ?? 6000, Math.round(h * c.hourP))
  const sizeText = sc.clean === 'office' ? `${sc.areaM2 || p.areaM2 || 120} m²` : (SIZE_LABEL[sizeIndex(p.bedrooms)] ?? '5+ bedrooms')
  const lines: QuoteLine[] = [
    line(`${CLEAN_LABEL[sc.clean]} · ${sizeText} · about ${h} cleaner-hours`, labour),
    line('Equipment and consumables', c.consumablesP),
  ]
  for (const a of sc.addons ?? []) {
    if (CLEAN_INCLUDES[sc.clean].includes(a) || a === 'windowsOut') continue
    lines.push(line(CLEAN_ADDON_LABEL[a], c.addons[a], 'svc', a === 'carpets' ? Math.max(1, sc.carpetRooms || 1) : 1))
  }
  const sl = schedLine(pr, o.sched)
  if (sl) lines.push(sl)
  const sub = linesTotal(lines)
  const spread = c.spreadPct / 100
  const priority = o.sched === 'priority'
  return {
    lines,
    hours: h,
    estLowP: Math.floor((sub * (1 - spread)) / 500) * 500,
    estHighP: Math.ceil((sub * (1 + spread)) / 500) * 500,
    needsReview: (sc.addons ?? []).includes('windowsOut') || sc.clean === 'office',
    proBase: {
      role: 'CLEANER',
      level: requiredCleanLevel(sc.clean),
      attendP: c.kitP,
      kitOnly: true,
      minutes: Math.round(h * 60),
      allowP: priority ? pr.sched.priorityProP : 0,
      allow: priority ? [['Priority allowance', pr.sched.priorityProP]] : [],
    } as ProBase,
    durationMin: Math.round((h * 60) / 15) * 15,
  }
}

export function requiredCleanLevel(clean: string): number {
  return ({ standard: 1, light: 1, general: 2, eot: 2, office: 2, deep: 3 } as Record<string, number>)[clean] ?? 1
}

/* ---- repairs: a fixed task price, or a paid diagnosis ---- */

export function priceDiagnosis(pr: Pricing) {
  return {
    lines: [line('Diagnostic visit: find the cause and price the repair. Credited against the repair if you go ahead', pr.repairs.diagnosisP)],
    proFeeP: pr.repairs.diagnosisProP,
    durationMin: 60,
  }
}

/** Labour share to the Pro, materials at cost, Priority allowance passed through. */
export function repairProFee(pr: Pricing, lines: QuoteLine[]): number {
  const pct = pr.repairs.labourProPct / 100
  return Math.round(
    lines.reduce((a, l) => {
      const v = l.q * l.u
      if (l.tag === 'materials' || /^materials/i.test(l.d)) return a + v
      if (l.tag === 'urgency') return a + pr.sched.priorityProP
      if (l.tag === 'credit' || l.tag === 'portfolio') return a
      return a + v * pct
    }, 0)
  )
}

/* ---- totals, contribution and portfolio ---- */

export function linesTotal(lines: QuoteLine[]): number {
  return lines.reduce((a, l) => a + Math.round(l.q * l.u), 0)
}

export function quoteTotals(pr: Pricing, lines: QuoteLine[], discP = 0) {
  const subP = linesTotal(lines)
  const taxP = pr.taxPct ? Math.round((subP * pr.taxPct) / 100) : 0
  return { subP, taxP, discP, totalP: Math.max(0, subP + taxP - discP) }
}

/** What's left after direct delivery costs (excluding tax), against the floor. */
export function contribution(pr: Pricing, revP: number, proP: number) {
  const c = pr.costs
  const payP = Math.round((revP * c.payPct) / 100 + c.payFixedP)
  const reworkP = Math.round((revP * c.reworkPct) / 100)
  const costsP = payP + c.opsP + reworkP
  const contribP = revP - proP - costsP
  const floorP = Math.max(pr.floor.minP, Math.round((revP * pr.floor.pct) / 100))
  return { revP, proP, payP, opsP: c.opsP, reworkP, costsP, contribP, floorP, ok: contribP >= floorP }
}

/** Rebates exclude Priority premiums, materials and credits. */
export function eligibleFeeP(lines: QuoteLine[]): number {
  return lines.reduce(
    (a, l) =>
      a + (l.tag === 'urgency' || l.tag === 'materials' || l.tag === 'credit' || /^materials/i.test(l.d) ? 0 : Math.round(l.q * l.u)),
    0
  )
}

export type PortfolioJob = { lines: QuoteLine[]; revP: number; proP: number }

/** Monthly tier and rebate due. The rebate never takes a job below the floor. */
export function portfolioSummary(pr: Pricing, jobs: PortfolioJob[]) {
  const r = pr.rebate
  const n = jobs.length
  const tier = n >= r.tier2 ? 'negotiated' : n >= r.tier1 ? 'rebate' : 'standard'
  let eligibleP = 0
  let capP = 0
  for (const j of jobs) {
    const e = eligibleFeeP(j.lines)
    eligibleP += e
    const x = contribution(pr, j.revP, j.proP)
    capP += Math.max(0, Math.min(Math.round((e * r.pct) / 100), x.contribP - x.floorP))
  }
  return {
    count: n,
    tier,
    eligibleP,
    rebateP: tier === 'rebate' ? capP : 0,
    toNext: tier === 'standard' ? r.tier1 - n : tier === 'rebate' ? r.tier2 - n : 0,
  }
}

/** Negotiated rate (25+ jobs a month): % off service fees, never below the floor. */
export function portfolioLine(pr: Pricing, pct: number, lines: QuoteLine[], proP: number): QuoteLine | null {
  if (!pct) return null
  const elig = lines.reduce((a, l) => a + (l.tag === 'svc' ? l.q * l.u : 0), 0)
  const x = contribution(pr, linesTotal(lines), proP)
  const off = Math.min(Math.round((elig * pct) / 100), Math.max(0, x.contribP - x.floorP))
  return off > 0 ? line(`Portfolio rate (${pct}% agreed)`, -off, 'portfolio') : null
}

/* ---- coverage: Bristol and the South West for everything; Birmingham cleaning only ---- */

export const COVERAGE = {
  ALL: ['BS', 'BA', 'GL', 'SN', 'TA', 'EX', 'TQ', 'PL', 'TR', 'DT', 'BH', 'SP'],
  CLEANING: ['B'],
}

export function postcodeArea(pc: string | null | undefined): string {
  return /^[A-Z]+/.exec(String(pc ?? '').trim().toUpperCase())?.[0] ?? ''
}

/** Null when the service is available at the postcode, otherwise the message to show. */
export function coverageBlock(postcode: string | null | undefined, service: ServiceKey, serviceLabel: string): string | null {
  const area = postcodeArea(postcode)
  if (COVERAGE.ALL.includes(area)) return null
  if (COVERAGE.CLEANING.includes(area)) {
    return service === 'CLEANING' ? null : `In Birmingham we offer cleaning now. ${serviceLabel} is coming soon.`
  }
  return `LISTD isn’t in ${area || 'this area'} yet. We cover Bristol, the South West and Birmingham, and we’re coming to your area soon.`
}
