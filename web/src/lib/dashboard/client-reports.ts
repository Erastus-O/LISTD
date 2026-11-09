import 'server-only'
import {
  and,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  lte,
  or,
  type SQL,
} from 'drizzle-orm'
import { db, jobs, properties } from '@/db'

/**
 * Server-only data layer for the client Reports page (M1 #13 / S5 of the
 * Lovable port roadmap). Reads delivered reports (jobs that have a
 * `report_url` and have moved past `submitted`).
 *
 * URL-driven filters mirror the jobs-filter-bar pattern: shareable URLs,
 * server-rendered, no client-side filtering of large lists.
 */

const REPORT_STATUSES = [
  'submitted',
  'reviewed',
  'signed',
  'completed',
  'paid',
] as const

const STATUSES = ['submitted', 'reviewed', 'signed', 'completed', 'paid'] as const
export type ReportStatus = (typeof STATUSES)[number]

const INSPECTION_TYPES_FILTER = [
  'new_inventory',
  'check_in',
  'check_out',
  'mid_term',
  'interim',
] as const
export type ReportInspectionType = (typeof INSPECTION_TYPES_FILTER)[number]

export type ReportsFilter = {
  q?: string
  type?: ReportInspectionType
  status?: ReportStatus
  propertyId?: string
  from?: string
  to?: string
}

export type ReportRow = {
  jobId: string
  status: string
  inspectionType: string
  scheduledDate: string
  deliveredAt: string | null
  reportUrl: string | null
  clientReportAccepted: boolean
  clientReportAcceptedAt: string | null
  property: {
    id: string
    addressLine1: string | null
    city: string | null
    postcode: string | null
  }
}

export type ReportsPageData = {
  rows: ReportRow[]
  total: number
  /** Distinct properties from the user's report set — populates the property filter dropdown. */
  propertyOptions: Array<{ id: string; address: string }>
}

const PAGE_LIMIT = 200

export async function loadClientReports(
  userId: string,
  filter: ReportsFilter
): Promise<ReportsPageData> {
  return db.transaction(async (tx) => {
    const where = buildWhere(userId, filter)

    const rows = await tx
      .select({
        jobId: jobs.id,
        status: jobs.status,
        inspectionType: jobs.inspectionType,
        scheduledDate: jobs.scheduledDate,
        deliveredAt: jobs.deliveredAt,
        reportUrl: jobs.reportUrl,
        clientReportAccepted: jobs.clientReportAccepted,
        clientReportAcceptedAt: jobs.clientReportAcceptedAt,
        propertyId: properties.id,
        addressLine1: properties.addressLine1,
        city: properties.city,
        postcode: properties.postcode,
      })
      .from(jobs)
      .leftJoin(properties, eq(jobs.propertyId, properties.id))
      .where(where)
      .orderBy(desc(jobs.deliveredAt), desc(jobs.scheduledDate))
      .limit(PAGE_LIMIT)

    // Distinct property options (always for this user's reports — independent
    // of the filter so the dropdown shows everything).
    const propertyRows = await tx
      .selectDistinct({
        propertyId: properties.id,
        addressLine1: properties.addressLine1,
        city: properties.city,
      })
      .from(jobs)
      .leftJoin(properties, eq(jobs.propertyId, properties.id))
      .where(
        and(
          eq(jobs.clientId, userId),
          isNotNull(jobs.reportUrl),
          inArray(jobs.status, [...REPORT_STATUSES]),
          isNotNull(properties.id)
        )
      )

    return {
      rows: rows
        .filter((r) => r.propertyId !== null)
        .map((r) => ({
          jobId: r.jobId,
          status: r.status,
          inspectionType: r.inspectionType,
          scheduledDate: r.scheduledDate,
          deliveredAt: r.deliveredAt ?? null,
          reportUrl: r.reportUrl ?? null,
          clientReportAccepted: r.clientReportAccepted ?? false,
          clientReportAcceptedAt: r.clientReportAcceptedAt ?? null,
          property: {
            id: r.propertyId as string,
            addressLine1: r.addressLine1,
            city: r.city,
            postcode: r.postcode,
          },
        })),
      total: rows.length,
      propertyOptions: propertyRows
        .filter((p): p is { propertyId: string; addressLine1: string | null; city: string | null } =>
          Boolean(p.propertyId)
        )
        .map((p) => ({
          id: p.propertyId,
          address:
            p.addressLine1 && p.city
              ? `${p.addressLine1}, ${p.city}`
              : p.addressLine1 ?? '(no address)',
        })),
    }
  })
}

function buildWhere(userId: string, f: ReportsFilter): SQL<unknown> | undefined {
  const clauses: Array<SQL<unknown>> = [
    eq(jobs.clientId, userId),
    isNotNull(jobs.reportUrl),
    inArray(jobs.status, [...REPORT_STATUSES]),
  ]

  if (f.type) clauses.push(eq(jobs.inspectionType, f.type))
  if (f.status) clauses.push(eq(jobs.status, f.status))
  if (f.propertyId) clauses.push(eq(jobs.propertyId, f.propertyId))
  if (f.from) clauses.push(gte(jobs.scheduledDate, f.from))
  if (f.to) clauses.push(lte(jobs.scheduledDate, f.to))

  if (f.q && f.q.trim()) {
    const like = `%${f.q.trim()}%`
    const search = or(
      ilike(properties.addressLine1, like),
      ilike(properties.postcode, like),
      ilike(properties.city, like)
    )
    if (search) clauses.push(search)
  }

  return and(...clauses)
}

export function parseReportsFilter(
  sp: Record<string, string | string[] | undefined>
): ReportsFilter {
  const f: ReportsFilter = {}
  const status = first(sp.status)
  if (status && (STATUSES as readonly string[]).includes(status)) {
    f.status = status as ReportStatus
  }
  const type = first(sp.type)
  if (type && (INSPECTION_TYPES_FILTER as readonly string[]).includes(type)) {
    f.type = type as ReportInspectionType
  }
  const q = first(sp.q)
  if (q) f.q = q
  const propertyId = first(sp.propertyId)
  if (propertyId) f.propertyId = propertyId
  const from = first(sp.from)
  if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) f.from = from
  const to = first(sp.to)
  if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) f.to = to
  return f
}

function first(v: string | string[] | undefined): string | undefined {
  if (!v) return undefined
  return Array.isArray(v) ? v[0] : v
}

/**
 * Group reports into a property → inspection-type tree for the folder UI.
 * Caller renders the tree; this just produces the structure.
 */
export type ReportFolder = {
  propertyId: string
  address: string
  cityPostcode: string
  groups: Array<{
    inspectionType: string
    reports: ReportRow[]
  }>
  total: number
}

export function groupReportsIntoFolders(rows: ReportRow[]): ReportFolder[] {
  const map = new Map<string, ReportFolder>()
  for (const r of rows) {
    let folder = map.get(r.property.id)
    if (!folder) {
      folder = {
        propertyId: r.property.id,
        address: r.property.addressLine1 ?? '(no address)',
        cityPostcode: [r.property.city, r.property.postcode]
          .filter(Boolean)
          .join(', '),
        groups: [],
        total: 0,
      }
      map.set(r.property.id, folder)
    }
    let group = folder.groups.find((g) => g.inspectionType === r.inspectionType)
    if (!group) {
      group = { inspectionType: r.inspectionType, reports: [] }
      folder.groups.push(group)
    }
    group.reports.push(r)
    folder.total += 1
  }
  return Array.from(map.values())
}
