import 'server-only'
import { and, eq } from 'drizzle-orm'
import {
  db,
  escrowTransactions,
  jobs,
  organisationMembers,
  profiles,
  properties,
} from '@/db'

export type OwnerPendingPayment = {
  jobId: string
  address: string | null
  postcode: string | null
  inspectionType: string
  amountPounds: number
  posterName: string | null
}

/**
 * Draft jobs in the caller's organisation that are awaiting payment (a
 * `pending` escrow row + a `draft` job). Only returns rows when the caller is
 * an active org **owner** — this powers the owner-pays-via-link "Awaiting your
 * payment" surface. Empty for non-owners / solo clients.
 *
 * Includes the poster's name so the owner can see which worker's post each
 * payment is for. Owner's own abandoned-checkout drafts surface here too,
 * which is intentional — they can finish paying from the same place.
 */
export async function loadOwnerPendingPayments(
  ownerUserId: string
): Promise<OwnerPendingPayment[]> {
  const [membership] = await db
    .select({ organisationId: organisationMembers.organisationId })
    .from(organisationMembers)
    .where(
      and(
        eq(organisationMembers.userId, ownerUserId),
        eq(organisationMembers.status, 'active'),
        eq(organisationMembers.orgRole, 'owner')
      )
    )
    .limit(1)
  if (!membership?.organisationId) return []

  const rows = await db
    .select({
      jobId: jobs.id,
      address: properties.addressLine1,
      postcode: properties.postcode,
      inspectionType: jobs.inspectionType,
      quotedPrice: jobs.quotedPrice,
      posterName: profiles.fullName,
    })
    .from(jobs)
    .innerJoin(
      escrowTransactions,
      and(
        eq(escrowTransactions.jobId, jobs.id),
        eq(escrowTransactions.status, 'pending')
      )
    )
    .innerJoin(properties, eq(properties.id, jobs.propertyId))
    .leftJoin(profiles, eq(profiles.userId, jobs.createdByUserId))
    .where(
      and(
        eq(jobs.organisationId, membership.organisationId),
        eq(jobs.status, 'draft')
      )
    )

  return rows.map((r) => ({
    jobId: r.jobId,
    address: r.address,
    postcode: r.postcode,
    inspectionType: r.inspectionType,
    amountPounds: Number(r.quotedPrice ?? 0),
    posterName: r.posterName,
  }))
}
