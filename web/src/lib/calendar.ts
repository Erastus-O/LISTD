import 'server-only'

/**
 * Pure-function calendar helpers — no DB, no auth, no I/O. Two outputs
 * from the same `CalendarEvent` payload:
 *
 *   - `buildIcsContent(event)` → a single .ics file body (RFC 5545)
 *     consumable by Google / Apple / Outlook / Fastmail / any client.
 *   - `buildGoogleCalendarUrl(event)` → a `calendar.google.com/render`
 *     deep link that pre-fills the event in Google Calendar in one tap.
 *
 * Both are deterministic on the same input (modulo `DTSTAMP`, which is
 * "now" by convention — it's the event-record-created timestamp, not
 * the event-occurs timestamp). Callers shouldn't memoize the .ics
 * content because the UID + DTSTAMP form a stable identity that
 * downstream calendar apps use to dedupe re-imports.
 */

export type CalendarEvent = {
  /** Stable identifier used as the .ics `UID`. Re-importing the same
   *  UID into the same calendar updates the existing event in place
   *  instead of creating a duplicate — important for the "I added the
   *  reminder yesterday, my admin rescheduled, I'm getting a fresh
   *  ICS" path. Use `job.id` so reschedules ride the same UID. */
  uid: string
  title: string
  /** Multi-line description. Newlines are escaped to `\n` in the ICS
   *  output and `\n` in the Google URL. */
  description: string
  /** Free-form location string — usually the property's full address. */
  location: string
  /** Event start (UTC). */
  startsAt: Date
  /** Event end (UTC). */
  endsAt: Date
  /** Optional organiser email shown to the user when they accept. */
  organizerEmail?: string
  /** Optional URL the event description deep-links to (LISTD job page). */
  url?: string
}

/**
 * Build an RFC 5545 ICS file body. Single VEVENT, no recurrence, no
 * alarms — calendar clients add their own default reminder cadence,
 * and we don't want to fight the user's existing prefs.
 *
 * Line-folding: RFC 5545 mandates ≤75 octets per line with continuation
 * via leading space. In practice every modern calendar accepts longer
 * lines, so we skip the folding for legibility. If a strict importer
 * ever complains, wrap with a `foldLine` helper.
 */
export function buildIcsContent(event: CalendarEvent): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//LISTD Pro//Inspection Appointments//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${event.uid}@listd.co.uk`,
    `DTSTAMP:${toIcsDate(new Date())}`,
    `DTSTART:${toIcsDate(event.startsAt)}`,
    `DTEND:${toIcsDate(event.endsAt)}`,
    `SUMMARY:${escapeIcsText(event.title)}`,
    `DESCRIPTION:${escapeIcsText(event.description)}`,
    `LOCATION:${escapeIcsText(event.location)}`,
  ]
  if (event.organizerEmail) {
    lines.push(`ORGANIZER:mailto:${event.organizerEmail}`)
  }
  if (event.url) {
    lines.push(`URL:${event.url}`)
  }
  lines.push('STATUS:CONFIRMED', 'TRANSP:OPAQUE', 'END:VEVENT', 'END:VCALENDAR')
  // RFC 5545 mandates CRLF line endings. Notably Google Calendar
  // tolerates LF but Outlook does not — using CRLF gives universal
  // compatibility.
  return lines.join('\r\n') + '\r\n'
}

/**
 * Build a one-click "Add to Google Calendar" URL. Doesn't require any
 * Google account or OAuth — opens Calendar with the event pre-filled
 * and the user confirms with one tap.
 *
 * Reference: https://github.com/InteractionDesignFoundation/add-event-to-calendar-docs/blob/main/services/google.md
 */
export function buildGoogleCalendarUrl(event: CalendarEvent): string {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.title,
    dates: `${toGoogleDate(event.startsAt)}/${toGoogleDate(event.endsAt)}`,
    details: event.description + (event.url ? `\n\n${event.url}` : ''),
    location: event.location,
  })
  return `https://calendar.google.com/calendar/render?${params.toString()}`
}

/**
 * Resolve a usable (start, end) pair from a job's schedule columns.
 *
 *   - If `scheduledAt` is set (the 0021-migration column), use it
 *     verbatim and end 2h later. That's the typical inspection
 *     duration and matches what clerks block on their personal cal.
 *   - Otherwise fall back to `scheduledDate` at 09:00 UTC. The user
 *     gets a day-blocker; they'll need to edit the time. We mark
 *     this as a soft fallback in the description so it's obvious.
 *
 * Returns `null` if both inputs are unusable.
 */
export function resolveJobSchedule(opts: {
  scheduledAt: string | null
  scheduledDate: string | null
  durationMinutes?: number
}): { startsAt: Date; endsAt: Date; isExactTime: boolean } | null {
  const duration = (opts.durationMinutes ?? 120) * 60 * 1000
  if (opts.scheduledAt) {
    const d = new Date(opts.scheduledAt)
    if (Number.isFinite(d.getTime())) {
      return {
        startsAt: d,
        endsAt: new Date(d.getTime() + duration),
        isExactTime: true,
      }
    }
  }
  if (opts.scheduledDate) {
    // Date-only column; pin to 09:00 UTC as a sensible default. ICS
    // can also support all-day events (VALUE=DATE), but a day-blocker
    // feels worse for an actual inspection slot than an obvious
    // editable placeholder time.
    const [y, m, d] = opts.scheduledDate.split('-').map((n) => Number(n))
    if (Number.isFinite(y) && Number.isFinite(m) && Number.isFinite(d)) {
      const start = new Date(Date.UTC(y, m - 1, d, 9, 0, 0))
      return {
        startsAt: start,
        endsAt: new Date(start.getTime() + duration),
        isExactTime: false,
      }
    }
  }
  return null
}

// ── Internal helpers ────────────────────────────────────────────────

/** Convert to ICS date-time format: YYYYMMDDTHHMMSSZ (UTC). */
function toIcsDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    d.getUTCFullYear() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    'T' +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    'Z'
  )
}

/** Google Calendar's URL format expects the same shape but minus the
 *  separators we kept for ICS legibility. Returns YYYYMMDDTHHMMSSZ. */
function toGoogleDate(d: Date): string {
  return toIcsDate(d)
}

/** Escape per RFC 5545 §3.3.11. Backslashes, commas, semicolons get
 *  escaped; literal newlines become `\n`. */
function escapeIcsText(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
}
