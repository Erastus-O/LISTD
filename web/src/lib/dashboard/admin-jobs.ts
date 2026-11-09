import 'server-only'
import {
  and,
  asc,
  desc,
  eq,
  ilike,
  inArray,
  or,
  sql,
  type SQL,
} from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import {
  db,
  jobs,
  messages,
  organisations,
  profiles,
  properties,
  tenantDetails,
} from '@/db'
import { type InspectionType, type ServiceTier } from '@/lib/pricing-matrix'

/**
 * Server-only data layer for the admin Jobs pages (S6c of the Lovable port).
 * Mirrors the shape Lovable's `useAdminJobsList` returned but moves the join
 * to Drizzle and the filter parsing to URL query params (shareable + cacheable
 * server-rendered views).
 *
 * RLS bypass is fine here: each call site verifies `requireRole('admin')`
 * before invoking, and admin-only data (other clients' addresses, clerk
 * payouts) is explicitly the point of these pages.
 */

const STATUS_VALUES = [
  'draft',
  'pending',
  'published',
  'accepted',
  'assigned',
  'in_progress',
  'submitted',
  'reviewed',
  'signed',
  'completed',
  'paid',
  'cancelled',
] as const
export type AdminJobStatus = (typeof STATUS_VALUES)[number]

const TYPE_VALUES = [
  'new_inventory',
  'check_in',
  'check_out',
  'mid_term',
  'interim',
] as const

export type AdminJobsFilter = {
  q?: string
  status?: AdminJobStatus
  type?: InspectionType
  /** Postcode district (e.g. "BS1"). Matches the outward code of the
   *  property postcode exactly. Driven by the map view's "Filter to
   *  district" pin action. */
  district?: string
  page?: number
}

export type AdminJobListRow = {
  id: string
  status: AdminJobStatus
  inspectionType: InspectionType
  serviceTier: ServiceTier
  scheduledDate: string
  quotedPrice: string | null
  finalPrice: string | null
  clerkPayout: string | null
  clerkFinalPayout: string | null
  createdAt: string
  property: {
    id: string
    addressLine1: string | null
    city: string | null
    postcode: string | null
    propertyType: string | null
    furnishedStatus: string | null
    bedrooms: number | null
    communalAreas: number | null
  } | null
  client: {
    userId: string
    fullName: string | null
    companyName: string | null
  } | null
  clerk: {
    userId: string
    fullName: string | null
    clerkLevel: number | null
  } | null
  organisation: {
    id: string
    name: string | null
  } | null
}

export type AdminJobsListData = {
  rows: AdminJobListRow[]
  total: number
  page: number
  pageSize: number
}

const PAGE_SIZE = 25
/** Hard cap for the unpaginated map view — defends against an admin
 *  accidentally trying to render thousands of pins. */
const MAP_VIEW_MAX = 500

export async function loadAdminJobsList(
  filter: AdminJobsFilter,
  options: { pageSize?: number } = {}
): Promise<AdminJobsListData> {
  const clientProfiles = alias(profiles, 'client_profile')
  const clerkProfiles = alias(profiles, 'clerk_profile')

  const where = buildListWhere(filter, clientProfiles)

  const pageSize = Math.min(options.pageSize ?? PAGE_SIZE, MAP_VIEW_MAX)
  const offset = (filter.page ?? 0) * pageSize

  return db.transaction(async (tx) => {
    const rows = await tx
      .select({
        id: jobs.id,
        status: jobs.status,
        inspectionType: jobs.inspectionType,
        serviceTier: jobs.serviceTier,
        scheduledDate: jobs.scheduledDate,
        quotedPrice: jobs.quotedPrice,
        finalPrice: jobs.finalPrice,
        clerkPayout: jobs.clerkPayout,
        clerkFinalPayout: jobs.clerkFinalPayout,
        createdAt: jobs.createdAt,
        clientId: jobs.clientId,
        clerkId: jobs.clerkId,
        organisationId: jobs.organisationId,
        propId: properties.id,
        propAddress: properties.addressLine1,
        propCity: properties.city,
        propPostcode: properties.postcode,
        propType: properties.propertyType,
        propFurnished: properties.furnishedStatus,
        propBedrooms: properties.bedrooms,
        propCommunal: properties.communalAreas,
        clientFullName: clientProfiles.fullName,
        clientCompany: clientProfiles.companyName,
        clerkFullName: clerkProfiles.fullName,
        clerkLevel: clerkProfiles.clerkLevel,
        orgName: organisations.name,
      })
      .from(jobs)
      .leftJoin(properties, eq(jobs.propertyId, properties.id))
      .leftJoin(clientProfiles, eq(clientProfiles.userId, jobs.clientId))
      .leftJoin(clerkProfiles, eq(clerkProfiles.userId, jobs.clerkId))
      .leftJoin(organisations, eq(organisations.id, jobs.organisationId))
      .where(where)
      .orderBy(desc(jobs.createdAt))
      .limit(pageSize)
      .offset(offset)

    const [{ count }] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(jobs)
      .leftJoin(properties, eq(jobs.propertyId, properties.id))
      .leftJoin(clientProfiles, eq(clientProfiles.userId, jobs.clientId))
      .where(where)

    return {
      rows: rows.map((r): AdminJobListRow => ({
        id: r.id,
        status: r.status as AdminJobStatus,
        inspectionType: r.inspectionType as InspectionType,
        serviceTier: r.serviceTier as ServiceTier,
        scheduledDate: r.scheduledDate,
        quotedPrice: r.quotedPrice,
        finalPrice: r.finalPrice,
        clerkPayout: r.clerkPayout,
        clerkFinalPayout: r.clerkFinalPayout,
        createdAt: r.createdAt,
        property: r.propId
          ? {
              id: r.propId,
              addressLine1: r.propAddress,
              city: r.propCity,
              postcode: r.propPostcode,
              propertyType: r.propType,
              furnishedStatus: r.propFurnished,
              bedrooms: r.propBedrooms,
              communalAreas: r.propCommunal,
            }
          : null,
        client: r.clientId
          ? {
              userId: r.clientId,
              fullName: r.clientFullName,
              companyName: r.clientCompany,
            }
          : null,
        clerk: r.clerkId
          ? {
              userId: r.clerkId,
              fullName: r.clerkFullName,
              clerkLevel: r.clerkLevel,
            }
          : null,
        organisation: r.organisationId
          ? { id: r.organisationId, name: r.orgName }
          : null,
      })),
      total: count ?? 0,
      page: filter.page ?? 0,
      pageSize,
    }
  })
}

function buildListWhere(
  f: AdminJobsFilter,
  clientProfiles: ReturnType<typeof alias<typeof profiles, 'client_profile'>>
): SQL<unknown> | undefined {
  const clauses: Array<SQL<unknown>> = []
  if (f.status) clauses.push(eq(jobs.status, f.status))
  if (f.type) clauses.push(eq(jobs.inspectionType, f.type))
  if (f.district && f.district.trim()) {
    // Outward code (everything before the space) — "BS1" matches
    // "BS1 4PQ" but not "BS10 …". `split_part` is Postgres-side so
    // the index can still be used via the function call.
    clauses.push(
      sql`upper(split_part(${properties.postcode}, ' ', 1)) = ${f.district.trim().toUpperCase()}`
    )
  }
  if (f.q && f.q.trim()) {
    const like = `%${f.q.trim()}%`
    const search = or(
      ilike(properties.addressLine1, like),
      ilike(properties.postcode, like),
      ilike(properties.city, like),
      ilike(clientProfiles.fullName, like),
      ilike(clientProfiles.companyName, like)
    )
    if (search) clauses.push(search)
  }
  if (clauses.length === 0) return undefined
  return and(...clauses)
}

export type AdminJobDetail = AdminJobListRow & {
  specialInstructions: string | null
  margin: string | null
  clerkBonus: string | null
  shortNoticeSurchargeApplied: boolean
  acceptedAt: string | null
  deliveredAt: string | null
  cancelledAt: string | null
  cancelledBy: string | null
  cancellationFee: string | null
  reportUrl: string | null
  clerkPaymentDate: string | null
  preferredTimeSlot: string | null
  /** Exact confirmed arrival timestamp (UTC ISO) — null until the pro
   *  commits one at accept or an admin sets it. */
  scheduledAt: string | null
  clerkLevelAtJob: number | null
  /** Tenants linked to this job (M3 portal). */
  tenants: Array<{
    id: string
    fullName: string | null
    email: string | null
    phone: string | null
    tenantOrder: number
  }>
  /** Profile-level fields the detail page surfaces (phone for client). */
  clientPhone: string | null
  /** Lovable parity: admin-only working notes (`jobs.admin_notes`). Distinct
   *  from `specialInstructions` which is client-supplied at booking. */
  adminNotes: string | null
  /** Access details captured at booking — surfaced for the attending clerk. */
  accessMethod: string | null
  accessCollection: string | null
  accessParkingNotes: string | null
  /** Sequential reference number behind the LST-YYYY-NNNN display ref. */
  jobRefNumber: number
  /** Display name of whoever created the job (client themselves or a staff
   *  member acting on their behalf). Surfaced under the Client card. */
  createdByName: string | null
  /** Tier-acknowledgement timestamp powers an audit-trail entry. */
  policyAcknowledgedAt: string | null
  /** FK on `jobs.invoice_id` — null while no invoice has been generated.
   *  Drives the "Generate invoice" vs "View invoice" affordance on the
   *  Financial card. */
  invoiceId: string | null
  /** Cleaner's completion checklist (clean jobs) — drives the admin sign-off
   *  card when the clean is `submitted`. Null until the cleaner submits. */
  cleaningChecklist: {
    checkedTasks?: number[]
    notes?: string
    photos?: string[]
    completedAt?: string
  } | null
}

export async function loadAdminJobDetail(
  jobId: string
): Promise<AdminJobDetail | null> {
  const clientProfiles = alias(profiles, 'client_profile')
  const clerkProfiles = alias(profiles, 'clerk_profile')

  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        id: jobs.id,
        status: jobs.status,
        inspectionType: jobs.inspectionType,
        serviceTier: jobs.serviceTier,
        scheduledDate: jobs.scheduledDate,
        preferredTimeSlot: jobs.preferredTimeSlot,
        scheduledAt: jobs.scheduledAt,
        specialInstructions: jobs.specialInstructions,
        quotedPrice: jobs.quotedPrice,
        finalPrice: jobs.finalPrice,
        clerkPayout: jobs.clerkPayout,
        clerkBonus: jobs.clerkBonus,
        clerkFinalPayout: jobs.clerkFinalPayout,
        margin: jobs.margin,
        cleaningChecklist: jobs.cleaningChecklist,
        shortNoticeSurchargeApplied: jobs.shortNoticeSurchargeApplied,
        acceptedAt: jobs.acceptedAt,
        deliveredAt: jobs.deliveredAt,
        cancelledAt: jobs.cancelledAt,
        cancelledBy: jobs.cancelledBy,
        cancellationFee: jobs.cancellationFee,
        reportUrl: jobs.reportUrl,
        clerkPaymentDate: jobs.clerkPaymentDate,
        clerkLevelAtJob: jobs.clerkLevelAtJob,
        adminNotes: jobs.adminNotes,
        accessMethod: jobs.accessMethod,
        accessCollection: jobs.accessCollection,
        accessParkingNotes: jobs.accessParkingNotes,
        jobRefNumber: jobs.jobRefNumber,
        createdByName: jobs.createdByName,
        policyAcknowledgedAt: jobs.policyAcknowledgedAt,
        invoiceId: jobs.invoiceId,
        createdAt: jobs.createdAt,
        clientId: jobs.clientId,
        clerkId: jobs.clerkId,
        organisationId: jobs.organisationId,
        propId: properties.id,
        propAddress: properties.addressLine1,
        propCity: properties.city,
        propPostcode: properties.postcode,
        propType: properties.propertyType,
        propFurnished: properties.furnishedStatus,
        propBedrooms: properties.bedrooms,
        propCommunal: properties.communalAreas,
        clientFullName: clientProfiles.fullName,
        clientCompany: clientProfiles.companyName,
        clientPhone: clientProfiles.phone,
        clerkFullName: clerkProfiles.fullName,
        clerkLevel: clerkProfiles.clerkLevel,
        orgName: organisations.name,
      })
      .from(jobs)
      .leftJoin(properties, eq(jobs.propertyId, properties.id))
      .leftJoin(clientProfiles, eq(clientProfiles.userId, jobs.clientId))
      .leftJoin(clerkProfiles, eq(clerkProfiles.userId, jobs.clerkId))
      .leftJoin(organisations, eq(organisations.id, jobs.organisationId))
      .where(eq(jobs.id, jobId))
      .limit(1)
    if (!row) return null

    const tenants = await tx
      .select({
        id: tenantDetails.id,
        fullName: tenantDetails.fullName,
        email: tenantDetails.email,
        phone: tenantDetails.phone,
        tenantOrder: tenantDetails.tenantOrder,
      })
      .from(tenantDetails)
      .where(eq(tenantDetails.jobId, jobId))
      .orderBy(asc(tenantDetails.tenantOrder))

    return {
      id: row.id,
      status: row.status as AdminJobStatus,
      inspectionType: row.inspectionType as InspectionType,
      serviceTier: row.serviceTier as ServiceTier,
      scheduledDate: row.scheduledDate,
      preferredTimeSlot: row.preferredTimeSlot,
      scheduledAt: row.scheduledAt,
      specialInstructions: row.specialInstructions,
      quotedPrice: row.quotedPrice,
      finalPrice: row.finalPrice,
      clerkPayout: row.clerkPayout,
      clerkBonus: row.clerkBonus,
      clerkFinalPayout: row.clerkFinalPayout,
      margin: row.margin,
      cleaningChecklist:
        (row.cleaningChecklist as AdminJobDetail['cleaningChecklist']) ?? null,
      shortNoticeSurchargeApplied: row.shortNoticeSurchargeApplied,
      acceptedAt: row.acceptedAt,
      deliveredAt: row.deliveredAt,
      cancelledAt: row.cancelledAt,
      cancelledBy: row.cancelledBy,
      cancellationFee: row.cancellationFee,
      reportUrl: row.reportUrl,
      clerkPaymentDate: row.clerkPaymentDate,
      clerkLevelAtJob: row.clerkLevelAtJob,
      createdAt: row.createdAt,
      property: row.propId
        ? {
            id: row.propId,
            addressLine1: row.propAddress,
            city: row.propCity,
            postcode: row.propPostcode,
            propertyType: row.propType,
            furnishedStatus: row.propFurnished,
            bedrooms: row.propBedrooms,
            communalAreas: row.propCommunal,
          }
        : null,
      client: row.clientId
        ? {
            userId: row.clientId,
            fullName: row.clientFullName,
            companyName: row.clientCompany,
          }
        : null,
      clientPhone: row.clientPhone,
      clerk: row.clerkId
        ? {
            userId: row.clerkId,
            fullName: row.clerkFullName,
            clerkLevel: row.clerkLevel,
          }
        : null,
      organisation: row.organisationId
        ? { id: row.organisationId, name: row.orgName }
        : null,
      tenants: tenants.map((t) => ({
        id: t.id,
        fullName: t.fullName,
        email: t.email,
        phone: t.phone,
        tenantOrder: t.tenantOrder,
      })),
      adminNotes: row.adminNotes,
      accessMethod: row.accessMethod,
      accessCollection: row.accessCollection,
      accessParkingNotes: row.accessParkingNotes,
      jobRefNumber: row.jobRefNumber,
      createdByName: row.createdByName,
      policyAcknowledgedAt: row.policyAcknowledgedAt,
      invoiceId: row.invoiceId,
    }
  })
}

export type JobMessageRow = {
  id: string
  senderId: string
  senderName: string | null
  recipientId: string
  messageText: string
  createdAt: string
}

/**
 * Message thread attached to a job — both directions, oldest first. Used by
 * the admin job-detail Message Thread card. Sender name is joined in so the
 * admin sees who said what without round-tripping for profile names.
 */
export async function loadJobMessages(
  jobId: string
): Promise<JobMessageRow[]> {
  const senderProfiles = alias(profiles, 'message_sender_profile')
  const rows = await db
    .select({
      id: messages.id,
      senderId: messages.senderId,
      senderName: senderProfiles.fullName,
      recipientId: messages.recipientId,
      messageText: messages.messageText,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .leftJoin(
      senderProfiles,
      eq(senderProfiles.userId, messages.senderId)
    )
    .where(eq(messages.jobId, jobId))
    .orderBy(asc(messages.createdAt))
  return rows.map((r) => ({
    id: r.id,
    senderId: r.senderId,
    senderName: r.senderName,
    recipientId: r.recipientId,
    messageText: r.messageText,
    createdAt: r.createdAt,
  }))
}

/**
 * Format the human-readable job reference: `LST-{year-of-createdAt}-{NNNN}`.
 * The year comes from `created_at` (so the booking year stays stable even if
 * the sequence drifts); the suffix is the row's `job_ref_number` padded to
 * four digits.
 */
export function formatJobRef(createdAt: string, refNumber: number): string {
  const year = new Date(createdAt).getUTCFullYear()
  const padded = String(refNumber).padStart(4, '0')
  return `LST-${year}-${padded}`
}

export function parseAdminJobsFilter(
  sp: Record<string, string | string[] | undefined>
): AdminJobsFilter {
  const f: AdminJobsFilter = {}
  const status = first(sp.status)
  if (status && (STATUS_VALUES as readonly string[]).includes(status)) {
    f.status = status as AdminJobStatus
  }
  const type = first(sp.type)
  if (type && (TYPE_VALUES as readonly string[]).includes(type)) {
    f.type = type as InspectionType
  }
  const q = first(sp.q)
  if (q) f.q = q
  const district = first(sp.district)
  if (district && /^[A-Za-z]{1,2}\d[A-Za-z\d]?$/.test(district.trim())) {
    f.district = district.trim().toUpperCase()
  }
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

export const ADMIN_JOB_STATUSES = STATUS_VALUES
export const ADMIN_JOB_INSPECTION_TYPES = TYPE_VALUES

export type VerifiedClerkOption = {
  userId: string
  fullName: string | null
  clerkLevel: number | null
}

/**
 * Verified clerks suitable for assignment via the admin job detail action
 * panel (S6c-2). The Lovable equivalent is `useVerifiedClerks` hook —
 * this is its server-side counterpart, called from the admin job detail page.
 */
export async function loadVerifiedClerks(): Promise<VerifiedClerkOption[]> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select({
        userId: profiles.userId,
        fullName: profiles.fullName,
        clerkLevel: profiles.clerkLevel,
      })
      .from(profiles)
      .where(eq(profiles.verificationStatus, 'verified'))
      .orderBy(asc(profiles.fullName))
    return rows.map((r) => ({
      userId: r.userId,
      fullName: r.fullName,
      clerkLevel: r.clerkLevel,
    }))
  })
}

export const STATUS_BADGE_TONE: Record<
  AdminJobStatus,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  draft: 'outline',
  pending: 'outline',
  published: 'default',
  accepted: 'default',
  assigned: 'default',
  in_progress: 'default',
  submitted: 'secondary',
  reviewed: 'secondary',
  signed: 'secondary',
  completed: 'secondary',
  paid: 'secondary',
  cancelled: 'destructive',
}
