import 'server-only'
import { and, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm'
import { db, jobs, profiles, properties } from '@/db'
import { type InspectionType } from '@/lib/pricing-matrix'

/**
 * Server-only data layer for the admin Reports management page.
 *
 * Surfaces PDF-management actions: viewing the current PDF, replacing it
 * (corrupt upload / redaction needed), and indirectly the signed-PDF
 * re-render that fires on tenant sign-off via the signed-pdf-pipeline.
 *
 * Paginated 25/page (mirrors `/admin/jobs`). Pre-pagination the loader
 * capped at 50 — once the platform produced 51+ reports, older rows
 * were silently invisible.
 */

const REPORT_STATUSES = [
  'submitted',
  'reviewed',
  'signed',
  'completed',
  'paid',
] as const

const PAGE_SIZE = 25

export type AdminReportsFilter = {
  page?: number
}

export type AdminReportRow = {
  jobId: string
  inspectionType: InspectionType
  status: string
  scheduledDate: string
  reportUrl: string | null
  deliveredAt: string | null
  property: {
    addressLine1: string | null
    city: string | null
    postcode: string | null
  } | null
  clerk: { userId: string; fullName: string | null } | null
  client: {
    userId: string
    fullName: string | null
    companyName: string | null
  } | null
}

export type AdminReportsData = {
  rows: AdminReportRow[]
  total: number
  page: number
  pageSize: number
}

export async function loadAdminReports(
  filter: AdminReportsFilter = {}
): Promise<AdminReportsData> {
  const page = Math.max(0, filter.page ?? 0)
  const offset = page * PAGE_SIZE
  return db.transaction(async (tx) => {
    const where = and(
      isNotNull(jobs.reportUrl),
      inArray(jobs.status, [...REPORT_STATUSES])
    )

    const rows = await tx
      .select({
        id: jobs.id,
        inspectionType: jobs.inspectionType,
        status: jobs.status,
        scheduledDate: jobs.scheduledDate,
        reportUrl: jobs.reportUrl,
        deliveredAt: jobs.deliveredAt,
        clientId: jobs.clientId,
        clerkId: jobs.clerkId,
        propAddress: properties.addressLine1,
        propCity: properties.city,
        propPostcode: properties.postcode,
      })
      .from(jobs)
      .leftJoin(properties, eq(properties.id, jobs.propertyId))
      .where(where)
      .orderBy(desc(jobs.scheduledDate))
      .limit(PAGE_SIZE)
      .offset(offset)

    const [{ count }] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(jobs)
      .where(where)

    if (rows.length === 0) {
      return { rows: [], total: count ?? 0, page, pageSize: PAGE_SIZE }
    }

    const userIds = Array.from(
      new Set(
        [
          ...rows.map((r) => r.clientId),
          ...rows.map((r) => r.clerkId),
        ].filter((id): id is string => Boolean(id))
      )
    )
    const profileRows =
      userIds.length === 0
        ? []
        : await tx
            .select({
              userId: profiles.userId,
              fullName: profiles.fullName,
              companyName: profiles.companyName,
            })
            .from(profiles)
            .where(inArray(profiles.userId, userIds))
    const profileMap = new Map(profileRows.map((p) => [p.userId, p]))

    return {
      rows: rows.map((r): AdminReportRow => {
        const clerkProfile = r.clerkId ? profileMap.get(r.clerkId) : null
        const clientProfile = r.clientId ? profileMap.get(r.clientId) : null
        return {
          jobId: r.id,
          inspectionType: r.inspectionType as InspectionType,
          status: r.status,
          scheduledDate: r.scheduledDate,
          reportUrl: r.reportUrl,
          deliveredAt: r.deliveredAt,
          property: r.propAddress
            ? {
                addressLine1: r.propAddress,
                city: r.propCity,
                postcode: r.propPostcode,
              }
            : null,
          clerk: r.clerkId
            ? {
                userId: r.clerkId,
                fullName: clerkProfile?.fullName ?? null,
              }
            : null,
          client: r.clientId
            ? {
                userId: r.clientId,
                fullName: clientProfile?.fullName ?? null,
                companyName: clientProfile?.companyName ?? null,
              }
            : null,
        }
      }),
      total: count ?? 0,
      page,
      pageSize: PAGE_SIZE,
    }
  })
}

export function parseAdminReportsFilter(
  sp: Record<string, string | string[] | undefined>
): AdminReportsFilter {
  const f: AdminReportsFilter = {}
  const page = first(sp.page)
  if (page) {
    const n = Number.parseInt(page, 10)
    if (Number.isFinite(n) && n >= 0) f.page = n
  }
  return f
}

function first(v: string | string[] | undefined): string | undefined {
  if (!v) return undefined
  return Array.isArray(v) ? v[0] : v
}
