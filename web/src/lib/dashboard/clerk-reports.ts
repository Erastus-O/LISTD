import 'server-only'
import {
  and,
  desc,
  eq,
  inArray,
  isNotNull,
  or,
  sql,
  type SQL,
} from 'drizzle-orm'
import { db, jobs, properties } from '@/db'
import { type InspectionType } from '@/lib/pricing-matrix'

/**
 * Server-only data layer for the clerk's Reports archive — every
 * inspection the calling clerk has signed off where a PDF is on file.
 * Mirrors the Mobile clerk PWA's `loadArchiveJobs` contract so the two
 * surfaces stay 1:1 (same row shape, same filter knobs, same
 * ordering).
 *
 * Limit caps at 100 rows; pagination is a follow-up if any clerk ever
 * accumulates more than that and complains about scrolling. The
 * preset-range filter (`month` / `quarter` / `year` / `all`) is the
 * usual escape hatch for "too many rows" today.
 *
 * `reportUrl` IS NOT NULL is the canonical "PDF exists" filter — we
 * use the same condition on the mobile archive and on the admin
 * quality-review queue.
 */

const ARCHIVE_STATUSES = [
  'submitted',
  'reviewed',
  'signed',
  'completed',
  'paid',
] as const

export type ReportsRange = 'all' | 'month' | 'quarter' | 'year'

export type ReportsFilter = {
  q?: string
  range?: ReportsRange
}

export type ClerkReportRow = {
  id: string
  inspectionType: InspectionType
  scheduledDate: string
  status: string
  clerkPayout: string | null
  reportUrl: string | null
  property: {
    addressLine1: string | null
    city: string | null
    postcode: string | null
  } | null
}

/**
 * Inclusive-from ISO `YYYY-MM-DD` for a given preset, or `null` for
 * `'all'`. Computed against `now()` at request time so the windows
 * roll without a cache bust.
 */
function rangeFrom(range: ReportsRange | undefined): string | null {
  const now = new Date()
  if (range === 'month') {
    const d = new Date(now)
    d.setUTCDate(d.getUTCDate() - 30)
    return d.toISOString().slice(0, 10)
  }
  if (range === 'quarter') {
    const d = new Date(now)
    d.setUTCDate(d.getUTCDate() - 92)
    return d.toISOString().slice(0, 10)
  }
  if (range === 'year') {
    const d = new Date(now)
    d.setUTCFullYear(d.getUTCFullYear() - 1)
    return d.toISOString().slice(0, 10)
  }
  return null
}

export async function loadClerkReports(
  clerkId: string,
  filter: ReportsFilter = {}
): Promise<ClerkReportRow[]> {
  const clauses: Array<SQL<unknown>> = [
    eq(jobs.clerkId, clerkId),
    inArray(jobs.status, [...ARCHIVE_STATUSES]),
    isNotNull(jobs.reportUrl),
  ]
  if (filter.q && filter.q.trim().length > 0) {
    const like = `%${filter.q.trim()}%`
    const fuzzy = or(
      sql`${properties.addressLine1} ilike ${like}`,
      sql`${properties.city} ilike ${like}`,
      sql`${properties.postcode} ilike ${like}`
    )
    if (fuzzy) clauses.push(fuzzy)
  }
  const from = rangeFrom(filter.range)
  if (from) {
    clauses.push(sql`${jobs.scheduledDate} >= ${from}`)
  }

  const rows = await db
    .select({
      id: jobs.id,
      inspectionType: jobs.inspectionType,
      scheduledDate: jobs.scheduledDate,
      status: jobs.status,
      clerkPayout: jobs.clerkPayout,
      reportUrl: jobs.reportUrl,
      propAddressLine1: properties.addressLine1,
      propCity: properties.city,
      propPostcode: properties.postcode,
    })
    .from(jobs)
    .leftJoin(properties, eq(properties.id, jobs.propertyId))
    .where(and(...clauses))
    // Most-recent-first matches the mobile archive (also DESC there).
    // Reports are read backwards in time — "latest finished work" is
    // typically what the clerk wants to grab and forward to a client.
    .orderBy(desc(jobs.scheduledDate))
    .limit(100)

  return rows.map((r) => ({
    id: r.id,
    inspectionType: r.inspectionType as InspectionType,
    scheduledDate: r.scheduledDate,
    status: r.status,
    clerkPayout: r.clerkPayout,
    reportUrl: r.reportUrl,
    property: r.propAddressLine1
      ? {
          addressLine1: r.propAddressLine1,
          city: r.propCity,
          postcode: r.propPostcode,
        }
      : null,
  }))
}

export function parseReportsFilter(
  sp: Record<string, string | string[] | undefined>
): ReportsFilter {
  const f: ReportsFilter = {}
  const q = first(sp.q)
  if (q && q.trim().length > 0) f.q = q.trim()
  const range = first(sp.range)
  if (
    range === 'month' ||
    range === 'quarter' ||
    range === 'year' ||
    range === 'all'
  ) {
    f.range = range
  }
  return f
}

function first(v: string | string[] | undefined): string | undefined {
  if (!v) return undefined
  return Array.isArray(v) ? v[0] : v
}

export const STATUS_LABELS: Record<string, string> = {
  submitted: 'Submitted',
  reviewed: 'Reviewed',
  signed: 'Signed',
  completed: 'Completed',
  paid: 'Paid',
}

export const INSPECTION_LABELS: Record<string, string> = {
  new_inventory: 'New Inventory',
  check_in: 'Check-In',
  check_out: 'Check-Out',
  mid_term: 'Mid-Term',
  interim: 'Interim',
}

export function formatGbp(amount: string | null | number): string {
  const n = typeof amount === 'number' ? amount : Number(amount ?? 0)
  if (!Number.isFinite(n)) return '£0'
  return `£${n.toFixed(2).replace(/\.00$/, '')}`
}
