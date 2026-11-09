import 'server-only'
import { and, asc, eq } from 'drizzle-orm'
import {
  db,
  jobs,
  messages,
  organisationMembers,
  profiles,
  properties,
  tenantDetails,
} from '@/db'
import { type InspectionType } from '@/lib/pricing-matrix'

/**
 * Server-only data layer for the client Job Detail page (Lovable port of
 * `ClientJobDetail.tsx`). Enforces ownership: only the job's `client_id`
 * (or any active member of the job's organisation) gets a row back.
 *
 * Returns the full join used by the detail UI: job + property + assigned
 * clerk profile + tenants + messages (read-only here; full messaging UI
 * lands when the messaging component ports).
 */

export type ClientJobDetail = {
  id: string
  inspectionType: InspectionType
  scheduledDate: string
  scheduledAt: string | null
  preferredTimeSlot: string | null
  status: string
  serviceTier: string
  quotedPrice: string | null
  finalPrice: string | null
  specialInstructions: string | null
  reportUrl: string | null
  acceptedAt: string | null
  deliveredAt: string | null
  cancelledAt: string | null
  cancelledBy: string | null
  cancellationFee: string | null
  createdAt: string
  property: {
    id: string
    addressLine1: string
    addressLine2: string | null
    city: string
    postcode: string
    propertyType: string | null
    bedrooms: number | null
    furnishedStatus: string | null
  } | null
  clerk: {
    userId: string
    fullName: string | null
    clerkLevel: number | null
    clerkRating: string | null
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
}

export async function loadClientJobDetail(
  jobId: string,
  clientId: string
): Promise<ClientJobDetail | null> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        id: jobs.id,
        clientId: jobs.clientId,
        clerkId: jobs.clerkId,
        organisationId: jobs.organisationId,
        inspectionType: jobs.inspectionType,
        scheduledDate: jobs.scheduledDate,
        scheduledAt: jobs.scheduledAt,
        preferredTimeSlot: jobs.preferredTimeSlot,
        status: jobs.status,
        serviceTier: jobs.serviceTier,
        quotedPrice: jobs.quotedPrice,
        finalPrice: jobs.finalPrice,
        specialInstructions: jobs.specialInstructions,
        reportUrl: jobs.reportUrl,
        acceptedAt: jobs.acceptedAt,
        deliveredAt: jobs.deliveredAt,
        cancelledAt: jobs.cancelledAt,
        cancelledBy: jobs.cancelledBy,
        cancellationFee: jobs.cancellationFee,
        createdAt: jobs.createdAt,
        propertyId: properties.id,
        propertyAddress1: properties.addressLine1,
        propertyAddress2: properties.addressLine2,
        propertyCity: properties.city,
        propertyPostcode: properties.postcode,
        propertyType: properties.propertyType,
        propertyBedrooms: properties.bedrooms,
        propertyFurnished: properties.furnishedStatus,
      })
      .from(jobs)
      .leftJoin(properties, eq(properties.id, jobs.propertyId))
      .where(eq(jobs.id, jobId))
      .limit(1)
    if (!row) return null

    // Ownership check — direct match on client_id, OR caller is an active
    // member of the job's organisation. Any other caller is treated as not
    // found so we don't leak existence.
    let isOwner = row.clientId === clientId
    if (!isOwner && row.organisationId) {
      const [membership] = await tx
        .select({ id: organisationMembers.id })
        .from(organisationMembers)
        .where(
          and(
            eq(organisationMembers.organisationId, row.organisationId),
            eq(organisationMembers.userId, clientId),
            eq(organisationMembers.status, 'active')
          )
        )
        .limit(1)
      isOwner = Boolean(membership)
    }
    if (!isOwner) return null

    // Clerk profile (separate query — single row, no join fan-out risk).
    const [clerkRow] = row.clerkId
      ? await tx
          .select({
            userId: profiles.userId,
            fullName: profiles.fullName,
            clerkLevel: profiles.clerkLevel,
            clerkRating: profiles.clerkRating,
          })
          .from(profiles)
          .where(eq(profiles.userId, row.clerkId))
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

    return {
      id: row.id,
      inspectionType: row.inspectionType as InspectionType,
      scheduledDate: row.scheduledDate,
      scheduledAt: row.scheduledAt,
      preferredTimeSlot: row.preferredTimeSlot,
      status: row.status,
      serviceTier: row.serviceTier,
      quotedPrice: row.quotedPrice,
      finalPrice: row.finalPrice,
      specialInstructions: row.specialInstructions,
      reportUrl: row.reportUrl,
      acceptedAt: row.acceptedAt,
      deliveredAt: row.deliveredAt,
      cancelledAt: row.cancelledAt,
      cancelledBy: row.cancelledBy,
      cancellationFee: row.cancellationFee,
      createdAt: row.createdAt,
      property: row.propertyId
        ? {
            id: row.propertyId,
            addressLine1: row.propertyAddress1 ?? '',
            addressLine2: row.propertyAddress2,
            city: row.propertyCity ?? '',
            postcode: row.propertyPostcode ?? '',
            propertyType: row.propertyType,
            bedrooms: row.propertyBedrooms,
            furnishedStatus: row.propertyFurnished,
          }
        : null,
      clerk: clerkRow
        ? {
            userId: clerkRow.userId,
            fullName: clerkRow.fullName,
            clerkLevel: clerkRow.clerkLevel,
            clerkRating: clerkRow.clerkRating,
          }
        : null,
      tenants,
      messages: msgRows,
    }
  })
}

export const STEPPER_STEPS = [
  { key: 'posted', label: 'Job Posted' },
  { key: 'accepted', label: 'Clerk Accepted' },
  { key: 'inProgress', label: 'Inspection in Progress' },
  { key: 'review', label: 'Report Under Review' },
  { key: 'delivered', label: 'Report Delivered' },
  { key: 'paid', label: 'Payment Received' },
] as const

export function getStepperIndex(status: string): number {
  switch (status) {
    case 'draft':
    case 'pending':
    case 'published':
      return 0
    case 'accepted':
    case 'assigned':
      return 1
    case 'in_progress':
      return 2
    case 'submitted':
    case 'reviewed':
      return 3
    case 'signed':
    case 'completed':
      return 4
    case 'paid':
      return 5
    case 'cancelled':
      return -1
    default:
      return 0
  }
}
