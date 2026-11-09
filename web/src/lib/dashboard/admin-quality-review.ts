import 'server-only'
import { asc, desc, eq, inArray, sql } from 'drizzle-orm'
import { db, jobs, profiles, properties, reports } from '@/db'

/**
 * Server-only data layer for the admin Quality Review queue (S6d-3 of the
 * Lovable port). The queue lists `reports.status='submitted'` rows awaiting
 * an admin decision. The detail page loads one report + its job context.
 *
 * The decision handler (`/api/admin/quality-review/[reportId]/decision`)
 * owns the state transition. This module is read-only.
 */

const PAGE_SIZE = 25

export type QualityReviewQueueItem = {
  reportId: string
  jobId: string
  submittedAt: string | null
  pdfUrl: string | null
  clerk: {
    userId: string
    fullName: string | null
  } | null
  inspectionType: string
  scheduledDate: string
  property: {
    addressLine1: string | null
    city: string | null
    postcode: string | null
  } | null
}

export type QualityReviewQueueFilter = {
  page?: number
}

export type QualityReviewQueueData = {
  items: QualityReviewQueueItem[]
  total: number
  page: number
  pageSize: number
}

export async function loadQualityReviewQueue(
  filter: QualityReviewQueueFilter = {}
): Promise<QualityReviewQueueData> {
  const page = Math.max(0, filter.page ?? 0)
  const offset = page * PAGE_SIZE
  return db.transaction(async (tx) => {
    const rows = await tx
      .select({
        reportId: reports.id,
        jobId: reports.jobId,
        clerkId: reports.clerkId,
        submittedAt: reports.submittedAt,
        pdfUrl: reports.pdfUrl,
        inspectionType: jobs.inspectionType,
        scheduledDate: jobs.scheduledDate,
        addressLine1: properties.addressLine1,
        city: properties.city,
        postcode: properties.postcode,
      })
      .from(reports)
      .leftJoin(jobs, eq(jobs.id, reports.jobId))
      .leftJoin(properties, eq(properties.id, jobs.propertyId))
      .where(eq(reports.status, 'submitted'))
      .orderBy(asc(reports.submittedAt))
      .limit(PAGE_SIZE)
      .offset(offset)

    const [{ count }] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(reports)
      .where(eq(reports.status, 'submitted'))

    if (rows.length === 0) {
      return { items: [], total: count ?? 0, page, pageSize: PAGE_SIZE }
    }

    const clerkIds = Array.from(
      new Set(rows.map((r) => r.clerkId).filter((id): id is string => Boolean(id)))
    )
    const clerkProfiles =
      clerkIds.length === 0
        ? []
        : await tx
            .select({ userId: profiles.userId, fullName: profiles.fullName })
            .from(profiles)
            .where(inArray(profiles.userId, clerkIds))
    const clerkMap = new Map(
      clerkProfiles.map((p) => [p.userId, p.fullName])
    )

    return {
      items: rows.map((r) => ({
        reportId: r.reportId,
        jobId: r.jobId ?? '',
        submittedAt: r.submittedAt ?? null,
        pdfUrl: r.pdfUrl,
        clerk: r.clerkId
          ? { userId: r.clerkId, fullName: clerkMap.get(r.clerkId) ?? null }
          : null,
        inspectionType: r.inspectionType ?? 'unknown',
        scheduledDate: r.scheduledDate ?? '',
        property: r.addressLine1
          ? {
              addressLine1: r.addressLine1,
              city: r.city,
              postcode: r.postcode,
            }
          : null,
      })),
      total: count ?? 0,
      page,
      pageSize: PAGE_SIZE,
    }
  })
}

export function parseQualityReviewFilter(
  sp: Record<string, string | string[] | undefined>
): QualityReviewQueueFilter {
  const f: QualityReviewQueueFilter = {}
  const raw = sp.page
  const page = Array.isArray(raw) ? raw[0] : raw
  if (page) {
    const n = Number.parseInt(page, 10)
    if (Number.isFinite(n) && n >= 0) f.page = n
  }
  return f
}

export type QualityReviewDetail = {
  report: {
    id: string
    jobId: string | null
    clerkId: string | null
    status: string
    pdfUrl: string | null
    adminNotes: string | null
    submittedAt: string | null
    approvedAt: string | null
  }
  job: {
    id: string
    inspectionType: string
    status: string
    scheduledDate: string
    clientId: string
  } | null
  property: {
    addressLine1: string | null
    city: string | null
    postcode: string | null
  } | null
  clerk: {
    userId: string
    fullName: string | null
    clerkLevel: number | null
  } | null
  /** Recent earlier review decisions on the same job — drives the
   *  "previously returned X times" alert on the detail. */
  priorAttempts: Array<{
    id: string
    status: string
    submittedAt: string | null
    adminNotes: string | null
  }>
}

export async function loadQualityReviewDetail(
  reportId: string
): Promise<QualityReviewDetail | null> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        id: reports.id,
        jobId: reports.jobId,
        clerkId: reports.clerkId,
        status: reports.status,
        pdfUrl: reports.pdfUrl,
        adminNotes: reports.adminNotes,
        submittedAt: reports.submittedAt,
        approvedAt: reports.approvedAt,
        jobInspectionType: jobs.inspectionType,
        jobStatus: jobs.status,
        jobScheduledDate: jobs.scheduledDate,
        jobClientId: jobs.clientId,
        propAddress: properties.addressLine1,
        propCity: properties.city,
        propPostcode: properties.postcode,
      })
      .from(reports)
      .leftJoin(jobs, eq(jobs.id, reports.jobId))
      .leftJoin(properties, eq(properties.id, jobs.propertyId))
      .where(eq(reports.id, reportId))
      .limit(1)
    if (!row) return null

    const clerkRow = row.clerkId
      ? await tx
          .select({
            userId: profiles.userId,
            fullName: profiles.fullName,
            clerkLevel: profiles.clerkLevel,
          })
          .from(profiles)
          .where(eq(profiles.userId, row.clerkId))
          .limit(1)
          .then((rs) => rs[0] ?? null)
      : null

    const priorAttempts = row.jobId
      ? await tx
          .select({
            id: reports.id,
            status: reports.status,
            submittedAt: reports.submittedAt,
            adminNotes: reports.adminNotes,
          })
          .from(reports)
          .where(eq(reports.jobId, row.jobId))
          .orderBy(desc(reports.submittedAt))
      : []

    return {
      report: {
        id: row.id,
        jobId: row.jobId,
        clerkId: row.clerkId,
        status: row.status ?? 'submitted',
        pdfUrl: row.pdfUrl,
        adminNotes: row.adminNotes,
        submittedAt: row.submittedAt,
        approvedAt: row.approvedAt,
      },
      job: row.jobInspectionType
        ? {
            id: row.jobId ?? '',
            inspectionType: row.jobInspectionType,
            status: row.jobStatus ?? 'unknown',
            scheduledDate: row.jobScheduledDate ?? '',
            clientId: row.jobClientId ?? '',
          }
        : null,
      property: row.propAddress
        ? {
            addressLine1: row.propAddress,
            city: row.propCity,
            postcode: row.propPostcode,
          }
        : null,
      clerk: clerkRow
        ? {
            userId: clerkRow.userId,
            fullName: clerkRow.fullName,
            clerkLevel: clerkRow.clerkLevel,
          }
        : null,
      priorAttempts: priorAttempts
        .filter((p) => p.id !== row.id)
        .map((p) => ({
          id: p.id,
          status: p.status ?? 'unknown',
          submittedAt: p.submittedAt,
          adminNotes: p.adminNotes,
        })),
    }
  })
}
