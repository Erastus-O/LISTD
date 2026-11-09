/**
 * UK wall-clock → UTC conversion for exact appointment times.
 *
 * Jobs store `scheduled_date` (a date) + `preferred_time_slot` (morning /
 * afternoon / flexible). An exact commitment ("I'll arrive at 09:30") is a
 * UK wall-clock time — the platform is UK-only — and must become a UTC
 * instant for `jobs.scheduled_at`. The server runs in UTC and the caller's
 * browser may be in any timezone, so neither `new Date(...)` locally nor on
 * the server gives the right answer. This converts via Intl with
 * `Europe/London`, correct across GMT/BST including the switch days, with
 * no timezone library.
 */

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/

/** Offset of Europe/London from UTC at the given instant, in ms. */
function londonOffsetMs(at: Date): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at)
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? NaN)
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second')
  )
  return asUtc - at.getTime()
}

/**
 * Convert a UK wall-clock time on a given date to a UTC ISO string.
 *
 * @param dateStr - `YYYY-MM-DD` (the job's `scheduled_date`)
 * @param timeStr - `HH:MM` 24-hour UK local time
 * @returns UTC ISO timestamp, or `null` if the inputs don't parse.
 */
export function ukWallTimeToUtcIso(
  dateStr: string,
  timeStr: string
): string | null {
  const timeMatch = TIME_RE.exec(timeStr)
  if (!timeMatch) return null
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr)
  if (!dateMatch) return null

  const [, y, mo, d] = dateMatch.map(Number)
  const h = Number(timeMatch[1])
  const mi = Number(timeMatch[2])
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null

  // Guess: treat the wall time as if it were UTC, then subtract London's
  // offset at that instant. Re-probe once in case the guess straddles a
  // DST transition (the offset at the corrected instant is authoritative).
  const guess = Date.UTC(y, mo - 1, d, h, mi, 0)
  if (!Number.isFinite(guess)) return null
  const first = londonOffsetMs(new Date(guess))
  let utcMs = guess - first
  const second = londonOffsetMs(new Date(utcMs))
  if (second !== first) utcMs = guess - second
  return new Date(utcMs).toISOString()
}

/** Format a UTC instant as UK wall-clock time (e.g. "09:30"). */
export function formatUkTime(iso: string): string {
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return ''
  return d.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/London',
  })
}

/**
 * Half-hourly arrival-time options a pro can commit to for a slot.
 * Ranges mirror the canonical timeframes in `lib/scheduling/slots.ts`
 * (morning 9–12, afternoon 12–17, evening 17–20); flexible/unknown slots
 * span the whole working day.
 */
export function arrivalTimeOptionsForSlot(
  slot: string | null | undefined
): string[] {
  const range =
    slot === 'morning'
      ? { from: 9, to: 12 }
      : slot === 'afternoon'
        ? { from: 12, to: 17 }
        : slot === 'evening'
          ? { from: 17, to: 20 }
          : { from: 9, to: 17 }
  const out: string[] = []
  for (let h = range.from; h < range.to; h++) {
    out.push(`${String(h).padStart(2, '0')}:00`)
    out.push(`${String(h).padStart(2, '0')}:30`)
  }
  return out
}
