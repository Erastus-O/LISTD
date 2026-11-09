import 'server-only'

/**
 * InventoryBase iCal parsing helpers — shared by the admin-triggered sync
 * handler ([/api/integrations/inventorybase/sync](../app/api/integrations/inventorybase/sync/route.ts))
 * and the drift-reconciliation cron ([/api/cron/inventorybase-drift](../app/api/cron/inventorybase-drift/route.ts)).
 *
 * IB exposes a per-org iCal calendar at
 *   `https://my.inventorybase.com/generate/calendar?key=<INVENTORYBASE_CALENDAR_KEY>`
 * which we parse server-side because there's no public API for the same
 * surface today.
 */

export type ICalEvent = {
  uid: string
  summary: string
  description: string
  dtstart: string
  dtend: string
  location: string
}

export function parseICalEvents(icalText: string): ICalEvent[] {
  const events: ICalEvent[] = []
  const blocks = icalText.split('BEGIN:VEVENT')

  for (let i = 1; i < blocks.length; i++) {
    const block = blocks[i].split('END:VEVENT')[0]
    const unfolded = block.replace(/\r?\n[ \t]/g, '')

    const getField = (name: string): string => {
      const regex = new RegExp(`^${name}[;:](.*)$`, 'm')
      const match = unfolded.match(regex)
      if (!match) return ''
      if (name === 'DTSTART' || name === 'DTEND') {
        const parts = match[0].split(':')
        return parts[parts.length - 1].trim()
      }
      return match[1].trim()
    }

    const event: ICalEvent = {
      uid: getField('UID'),
      summary: getField('SUMMARY'),
      description: getField('DESCRIPTION'),
      dtstart: getField('DTSTART'),
      dtend: getField('DTEND'),
      location: getField('LOCATION'),
    }
    if (event.uid && event.summary) events.push(event)
  }
  return events
}

/**
 * Convert an iCal date (e.g. `20260315T143000Z` or `20260315`) to ISO 8601.
 * Returns the original string on parse failure rather than throwing.
 */
export function icalDateToISO(icalDate: string): string {
  if (!icalDate) return ''
  const clean = icalDate.replace(/[^0-9TZ]/g, '')
  if (clean.length >= 8) {
    const year = clean.slice(0, 4)
    const month = clean.slice(4, 6)
    const day = clean.slice(6, 8)
    if (clean.length >= 15) {
      const hour = clean.slice(9, 11)
      const min = clean.slice(11, 13)
      const sec = clean.slice(13, 15)
      return `${year}-${month}-${day}T${hour}:${min}:${sec}Z`
    }
    return `${year}-${month}-${day}`
  }
  return icalDate
}

/** Strip everything but YYYY-MM-DD from an ISO or iCal date string. */
export function extractDate(isoOrIcal: string): string {
  return isoOrIcal ? isoOrIcal.slice(0, 10) : ''
}

export function normalizeAddress(addr: string): string {
  return addr
    .toLowerCase()
    .replace(/[,.\-/\\#]+/g, ' ')
    .replace(/\b(flat|apartment|apt|unit|suite|floor|room)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function addressSimilarity(a: string, b: string): number {
  const setA = new Set(normalizeAddress(a).split(' ').filter((w) => w.length > 1))
  const setB = new Set(normalizeAddress(b).split(' ').filter((w) => w.length > 1))
  if (setA.size === 0 || setB.size === 0) return 0
  let overlap = 0
  for (const w of setA) if (setB.has(w)) overlap++
  return overlap / Math.max(setA.size, setB.size)
}

/**
 * Resolve the IB calendar URL from the env. Returns `null` if the env var
 * isn't set so the caller can short-circuit cleanly.
 */
export function getIcalUrl(): string | null {
  const key = process.env.INVENTORYBASE_CALENDAR_KEY
  if (!key) return null
  return key.startsWith('http')
    ? key
    : `https://my.inventorybase.com/generate/calendar?key=${key}`
}

/** Fetch + parse the IB iCal feed. Throws on HTTP non-2xx. */
export async function fetchIcalEvents(url: string): Promise<ICalEvent[]> {
  const res = await fetch(url)
  if (!res.ok) {
    const body = await res.text().catch(() => '<unreadable>')
    throw new Error(
      `InventoryBase calendar fetch failed: ${res.status} : ${body.slice(0, 200)}`
    )
  }
  return parseICalEvents(await res.text())
}
