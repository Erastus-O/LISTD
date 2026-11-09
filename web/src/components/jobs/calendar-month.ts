/**
 * Server-or-client utility for the jobs calendar — pure date parsing,
 * deliberately NOT under a `'use client'` directive so server pages can
 * import it without dragging the rest of `jobs-calendar.tsx` (which uses
 * `usePathname` / `useSearchParams`) through the client-boundary
 * machinery. The calendar component itself still imports this for
 * runtime parsing of its own URL state if needed.
 */

export function parseMonthParam(value: string | undefined): {
  year: number
  month: number
} {
  const now = new Date()
  const fallback = { year: now.getFullYear(), month: now.getMonth() + 1 }
  if (!value) return fallback
  const m = value.match(/^(\d{4})-(\d{2})$/)
  if (!m) return fallback
  const year = Number.parseInt(m[1]!, 10)
  const month = Number.parseInt(m[2]!, 10)
  if (year < 2000 || year > 2100 || month < 1 || month > 12) return fallback
  return { year, month }
}
