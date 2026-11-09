import 'server-only'

/**
 * Recurring-invoice cadence helpers. Pure functions — no DB — so they're
 * unit-testable in isolation. The cron handler at
 * `/api/cron/issue-recurring` calls `advanceNextRun` after each mint to
 * compute the new `next_run_at`.
 *
 * `monthly` clamps to day 28 (the schema check constraint matches) so we
 * sidestep the Feb-30 problem entirely. Admins who need an end-of-month
 * cadence pick day 28; if business needs a real EoM, that's a follow-up.
 */

export type Cadence = 'monthly' | 'weekly' | 'quarterly'

export type CadenceSpec = {
  cadence: Cadence
  /** Required for monthly/quarterly. 1–28. */
  dayOfMonth?: number | null
  /** Required for weekly. 0=Sun … 6=Sat. */
  dayOfWeek?: number | null
}

/** Pure helper that returns YYYY-MM-DD given a `Date` interpreted in UTC. */
export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/**
 * Compute the first `next_run_at` for a freshly created template, given
 * its `starts_on`. The first run is the next occurrence of the cadence
 * date that's >= startsOn (inclusive).
 */
export function firstRunAfter(startsOn: string, spec: CadenceSpec): string {
  const start = parseUtcDate(startsOn)
  return advanceFromAnchor(start, spec, /* inclusive */ true)
}

/**
 * Advance from `lastRunIso` to the next firing date strictly after it.
 */
export function advanceNextRun(lastRunIso: string, spec: CadenceSpec): string {
  const last = parseUtcDate(lastRunIso)
  // Move one day forward so we don't land on the same date again.
  last.setUTCDate(last.getUTCDate() + 1)
  return advanceFromAnchor(last, spec, /* inclusive */ true)
}

function advanceFromAnchor(
  anchor: Date,
  spec: CadenceSpec,
  inclusive: boolean
): string {
  if (spec.cadence === 'weekly') {
    const target = clamp(spec.dayOfWeek ?? 0, 0, 6)
    const cur = anchor.getUTCDay()
    let delta = (target - cur + 7) % 7
    if (delta === 0 && !inclusive) delta = 7
    anchor.setUTCDate(anchor.getUTCDate() + delta)
    return isoDate(anchor)
  }

  const dom = clamp(spec.dayOfMonth ?? 1, 1, 28)
  const monthStep = spec.cadence === 'quarterly' ? 3 : 1

  // Try anchor's month first; if the dom is already past anchor's day
  // (or the same and !inclusive), jump forward by monthStep months.
  let year = anchor.getUTCFullYear()
  let month = anchor.getUTCMonth()
  const day = anchor.getUTCDate()
  if (day > dom || (day === dom && !inclusive)) {
    month += monthStep
  }
  // Normalise overflow.
  while (month > 11) {
    month -= 12
    year += 1
  }
  return isoDate(new Date(Date.UTC(year, month, dom)))
}

function parseUtcDate(iso: string): Date {
  // `new Date('YYYY-MM-DD')` parses as UTC midnight in modern engines —
  // be explicit for safety.
  const [y, m, d] = iso.split('-').map((n) => Number.parseInt(n, 10))
  return new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1))
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}
