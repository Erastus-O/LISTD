import 'server-only'
import { and, asc, desc, eq, inArray, ne } from 'drizzle-orm'
import {
  db,
  jobs,
  messages,
  profiles,
  properties,
  tenantDetails,
} from '@/db'
import {
  parseClerkPayoutLines,
  type ClerkPayoutLine,
  type InspectionType,
} from '@/lib/pricing-matrix'

/**
 * Server-only data layer for the clerk Job Detail page (Lovable port of
 * `ClerkJobDetail.tsx`). Enforces ownership server-side: only the
 * `clerk_id` matching the caller (or an admin) gets a row back.
 *
 * Statuses outside the clerk's working window (`accepted` through `paid`,
 * incl. `signed`) are also rejected — for unaccepted jobs the clerk should
 * be on /clerk/jobs/available, not here.
 */

const ALLOWED_STATUSES = [
  'accepted',
  'in_progress',
  'submitted',
  'reviewed',
  'signed',
  'completed',
  'paid',
] as const

export type ClerkJobDetail = {
  id: string
  inspectionType: InspectionType
  /** Every service on the booking — a client can bundle Inventory +
   *  Check-In into one job, and only the first lands in `inspectionType`. */
  inspectionTypes: string[]
  scheduledDate: string
  scheduledAt: string | null
  preferredTimeSlot: string | null
  status: string
  serviceTier: string
  clerkPayout: string | null
  clerkFinalPayout: string | null
  /** Itemised clerk-pay lines (base service + per-feature add-ons). Empty for
   *  legacy jobs created before the breakdown was recorded. */
  payoutLines: ClerkPayoutLine[]
  /** 30-min slots the tenant said they're available for (within the booked
   *  timeframe). Empty until the tenant picks. */
  tenantSlots: string[]
  specialInstructions: string | null
  reportUrl: string | null
  acceptedAt: string | null
  deliveredAt: string | null
  createdAt: string
  property: {
    id: string
    addressLine1: string
    addressLine2: string | null
    city: string
    postcode: string
    propertyType: string | null
    /** 0039 — flat / house / …; null on properties booked before it. */
    dwellingType: string | null
    bedrooms: number | null
    furnishedStatus: string | null
  } | null
  /** The job's client (organisation if present, else the named user) — used
   *  for the message thread + display. */
  client: {
    userId: string
    fullName: string | null
    companyName: string | null
  } | null
  tenants: Array<{
    id: string
    fullName: string | null
    email: string | null
    phone: string | null
  }>
  messages: Array<{
    id: string
    senderId: string
    recipientId: string
    messageText: string
    createdAt: string
  }>
  /** Last 5 completed jobs at this property — repeat-business signal so
   *  the clerk knows the property has been done before (and by whom). */
  previousJobsAtProperty: Array<{
    id: string
    inspectionType: string
    scheduledDate: string
    clerkFullName: string | null
  }>
}

export async function loadClerkJobDetail(
  jobId: string,
  clerkId: string,
  isAdmin: boolean
): Promise<ClerkJobDetail | null> {
  const detail = await db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        id: jobs.id,
        clerkId: jobs.clerkId,
        clientId: jobs.clientId,
        inspectionType: jobs.inspectionType,
        inspectionTypes: jobs.inspectionTypes,
        scheduledDate: jobs.scheduledDate,
        scheduledAt: jobs.scheduledAt,
        preferredTimeSlot: jobs.preferredTimeSlot,
        status: jobs.status,
        serviceTier: jobs.serviceTier,
        clerkPayout: jobs.clerkPayout,
        clerkFinalPayout: jobs.clerkFinalPayout,
        clerkPayoutBreakdown: jobs.clerkPayoutBreakdown,
        specialInstructions: jobs.specialInstructions,
        reportUrl: jobs.reportUrl,
        acceptedAt: jobs.acceptedAt,
        deliveredAt: jobs.deliveredAt,
        createdAt: jobs.createdAt,
        propertyId: properties.id,
        propertyAddress1: properties.addressLine1,
        propertyAddress2: properties.addressLine2,
        propertyCity: properties.city,
        propertyPostcode: properties.postcode,
        propertyType: properties.propertyType,
        dwellingType: properties.dwellingType,
        propertyBedrooms: properties.bedrooms,
        propertyFurnished: properties.furnishedStatus,
      })
      .from(jobs)
      .leftJoin(properties, eq(properties.id, jobs.propertyId))
      .where(eq(jobs.id, jobId))
      .limit(1)
    if (!row) return null

    // Ownership check — clerk must match, OR caller is admin (for QA /
    // impersonation).
    if (!isAdmin && row.clerkId !== clerkId) return null
    if (!(ALLOWED_STATUSES as readonly string[]).includes(row.status)) {
      return null
    }

    // Client profile — separate read, no fan-out risk.
    const [clientRow] = row.clientId
      ? await tx
          .select({
            userId: profiles.userId,
            fullName: profiles.fullName,
            companyName: profiles.companyName,
          })
          .from(profiles)
          .where(eq(profiles.userId, row.clientId))
          .limit(1)
      : [null]

    const tenants = await tx
      .select({
        id: tenantDetails.id,
        fullName: tenantDetails.fullName,
        email: tenantDetails.email,
        phone: tenantDetails.phone,
      })
      .from(tenantDetails)
      .where(eq(tenantDetails.jobId, jobId))
      .orderBy(asc(tenantDetails.tenantOrder))

    const msgRows = await tx
      .select({
        id: messages.id,
        senderId: messages.senderId,
        recipientId: messages.recipientId,
        messageText: messages.messageText,
        createdAt: messages.createdAt,
      })
      .from(messages)
      .where(eq(messages.jobId, jobId))
      .orderBy(asc(messages.createdAt))

    // Previous jobs at this property — last 5 completed inspections
    // (excluding this one) with their clerk's name.
    const previousRows = row.propertyId
      ? await tx
          .select({
            id: jobs.id,
            inspectionType: jobs.inspectionType,
            scheduledDate: jobs.scheduledDate,
            clerkId: jobs.clerkId,
          })
          .from(jobs)
          .where(
            and(
              eq(jobs.propertyId, row.propertyId),
              eq(jobs.status, 'completed'),
              ne(jobs.id, jobId)
            )
          )
          .orderBy(desc(jobs.scheduledDate))
          .limit(5)
      : []
    const prevClerkIds = Array.from(
      new Set(
        previousRows
          .map((p) => p.clerkId)
          .filter((id): id is string => Boolean(id))
      )
    )
    const prevClerkRows =
      prevClerkIds.length === 0
        ? []
        : await tx
            .select({
              userId: profiles.userId,
              fullName: profiles.fullName,
            })
            .from(profiles)
            .where(inArray(profiles.userId, prevClerkIds))
    const prevClerkMap = new Map(
      prevClerkRows.map((p) => [p.userId, p.fullName ?? null])
    )

    return {
      id: row.id,
      inspectionType: row.inspectionType as InspectionType,
      inspectionTypes: row.inspectionTypes ?? [],
      scheduledDate: row.scheduledDate,
      scheduledAt: row.scheduledAt,
      preferredTimeSlot: row.preferredTimeSlot,
      status: row.status,
      serviceTier: row.serviceTier,
      clerkPayout: row.clerkPayout,
      clerkFinalPayout: row.clerkFinalPayout,
      payoutLines: parseClerkPayoutLines(row.clerkPayoutBreakdown),
      // Filled by a guarded query after the tx (see below) so a pre-0026
      // database can't break this hot path.
      tenantSlots: [] as string[],
      specialInstructions: row.specialInstructions,
      reportUrl: row.reportUrl,
      acceptedAt: row.acceptedAt,
      deliveredAt: row.deliveredAt,
      createdAt: row.createdAt,
      property: row.propertyId
        ? {
            id: row.propertyId,
            addressLine1: row.propertyAddress1 ?? '',
            addressLine2: row.propertyAddress2,
            city: row.propertyCity ?? '',
            postcode: row.propertyPostcode ?? '',
            propertyType: row.propertyType,
            dwellingType: row.dwellingType,
            bedrooms: row.propertyBedrooms,
            furnishedStatus: row.propertyFurnished,
          }
        : null,
      client: clientRow
        ? {
            userId: clientRow.userId,
            fullName: clientRow.fullName,
            companyName: clientRow.companyName,
          }
        : null,
      tenants,
      messages: msgRows,
      previousJobsAtProperty: previousRows.map((p) => ({
        id: p.id,
        inspectionType: p.inspectionType,
        scheduledDate: p.scheduledDate,
        clerkFullName: p.clerkId
          ? prevClerkMap.get(p.clerkId) ?? null
          : null,
      })),
    }
  })

  // Tenant slots come from a column added in 0026. Fetch them in a separate,
  // guarded query so a database that hasn't applied 0026 yet can't break the
  // (hot) job-detail path — it just yields no slots until the migration lands.
  if (detail) detail.tenantSlots = await fetchTenantSlotsSafe(jobId)
  return detail
}

async function fetchTenantSlotsSafe(jobId: string): Promise<string[]> {
  try {
    const [r] = await db
      .select({ v: jobs.tenantSelectedSlots })
      .from(jobs)
      .where(eq(jobs.id, jobId))
      .limit(1)
    return parseTenantSlots(r?.v)
  } catch {
    return []
  }
}

/** Read the `tenant_selected_slots` jsonb into a sorted list of "HH:MM" starts. */
function parseTenantSlots(value: unknown): string[] {
  if (!value || typeof value !== 'object') return []
  const slots = (value as { slots?: unknown }).slots
  if (!Array.isArray(slots)) return []
  return slots
    .filter((s): s is string => typeof s === 'string' && /^\d{2}:\d{2}$/.test(s))
    .sort()
}
