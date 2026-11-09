/**
 * Inspection time slots. The client picks a broad TIMEFRAME at booking
 * (morning / afternoon / evening — stored on `jobs.preferred_time_slot`);
 * once a clerk accepts, the tenant picks one or more 30-minute SLOTS within
 * that timeframe. Ranges mirror the booking date/time selector.
 */
export const TIMEFRAMES = ['morning', 'afternoon', 'evening'] as const
export type Timeframe = (typeof TIMEFRAMES)[number]

const RANGES: Record<Timeframe, { start: string; end: string; label: string }> = {
  morning: { start: '09:00', end: '12:00', label: 'Morning' },
  afternoon: { start: '12:00', end: '17:00', label: 'Afternoon' },
  evening: { start: '17:00', end: '20:00', label: 'Evening' },
}

const SLOT_MINUTES = 30

export function isTimeframe(v: string | null | undefined): v is Timeframe {
  return v === 'morning' || v === 'afternoon' || v === 'evening'
}

export function timeframeLabel(v: string | null | undefined): string {
  return isTimeframe(v) ? RANGES[v].label : 'Flexible'
}

/** The window (e.g. "9:00 – 12:00") for a timeframe, or '' if unknown. */
export function timeframeWindow(v: string | null | undefined): string {
  if (!isTimeframe(v)) return ''
  return `${fmt(toMin(RANGES[v].start))} – ${fmt(toMin(RANGES[v].end))}`
}

/** 30-minute slot start times ("HH:MM") within a timeframe; [] if unknown. */
export function slotsForTimeframe(v: string | null | undefined): string[] {
  if (!isTimeframe(v)) return []
  const out: string[] = []
  const endM = toMin(RANGES[v].end)
  for (let m = toMin(RANGES[v].start); m < endM; m += SLOT_MINUTES) {
    out.push(toHHMM(m))
  }
  return out
}

/** Human label for a slot start, e.g. "09:00" → "9:00 – 9:30". */
export function formatSlot(start: string): string {
  const s = toMin(start)
  return `${fmt(s)} – ${fmt(s + SLOT_MINUTES)}`
}

/**
 * Keep only valid, de-duplicated slots that belong to the timeframe, sorted.
 * Used to sanitise tenant input before persisting.
 */
export function sanitiseSlots(
  v: string | null | undefined,
  slots: string[]
): string[] {
  const valid = new Set(slotsForTimeframe(v))
  const kept = new Set(slots.filter((s) => valid.has(s)))
  return Array.from(kept).sort()
}

function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(':').map((n) => parseInt(n, 10))
  return h * 60 + m
}
function toHHMM(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}
/** 12-hour-ish display without am/pm (e.g. 540 → "9:00", 750 → "12:30"). */
function fmt(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  return `${h}:${String(m).padStart(2, '0')}`
}
