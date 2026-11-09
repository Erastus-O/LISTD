import 'server-only'
import {
  and,
  asc,
  eq,
  gte,
  inArray,
  isNull,
  lte,
  not,
  sql,
  type SQL,
} from 'drizzle-orm'
import { db, jobs, properties } from '@/db'
import { type InspectionType } from '@/lib/pricing-matrix'

/**
 * Server-only data layer for the clerk's "My Jobs" surface (Lovable port of
 * `ClerkJobs.tsx`). Returns the calling clerk's assigned jobs (excluding
 * cancelled) joined with property metadata, plus a count of currently
 * available jobs to drive the "View available (N)" callout.
 *
 * The Available tab Lovable rolled into this page lives at its own route in
 * Listd-NEXT (`/clerk/jobs/available`) — kept separate so the rich filter
 * bar + coverage matching don't have to share render space.
 */

const PENDING_STATUSES = ['accepted', 'assigned', 'pending', 'published'] as const
const IN_PROGRESS_STATUSES = ['in_progress'] as const
const COMPLETED_STATUSES = [
  'submitted',
  'reviewed',
  'signed',
  'completed',
  'paid',
] as const

export type ClerkJobsFilter = {
  status?: 'pending' | 'in_progress' | 'completed'
  from?: string
  to?: string
}

export type ClerkJobRow = {
  id: string
  inspectionType: InspectionType
  scheduledDate: string
  preferredTimeSlot: string | null
  status: string
  serviceTier: string
  clerkPayout: string | null
  createdByName: string | null
  property: {
    addressLine1: string | null
    city: string | null
    postcode: string | null
    propertyType: string | null
    bedrooms: number | null
    furnishedStatus: string | null
  } | null
}

export type ClerkJobsData = {
  rows: ClerkJobRow[]
  /** Used by the My-Jobs page for the "View available (N)" callout. */
  availableCount: number
}

export async function loadClerkJobs(
  clerkId: string,
  filter: ClerkJobsFilter = {}
): Promise<ClerkJobsData> {
  return db.transaction(async (tx) => {
    const where = buildWhere(clerkId, filter)

    const rawRows = await tx
      .select({
        id: jobs.id,
        inspectionType: jobs.inspectionType,
        scheduledDate: jobs.scheduledDate,
        preferredTimeSlot: jobs.preferredTimeSlot,
        status: jobs.status,
        serviceTier: jobs.serviceTier,
        clerkPayout: jobs.clerkPayout,
        createdByName: jobs.createdByName,
        propAddressLine1: properties.addressLine1,
        propCity: properties.city,
        propPostcode: properties.postcode,
        propType: properties.propertyType,
        propBedrooms: properties.bedrooms,
        propFurnished: properties.furnishedStatus,
      })
      .from(jobs)
      .leftJoin(properties, eq(properties.id, jobs.propertyId))
      .where(where)
      // Soonest-first matches the mobile My Jobs surface so a clerk who
      // uses both web + PWA sees the same ordering on their assigned
      // work. Also matches the Available list above it.
      .orderBy(asc(jobs.scheduledDate))

    const [{ availableCount }] = await tx
      .select({ availableCount: sql<number>`count(*)::int` })
      .from(jobs)
      .where(and(eq(jobs.status, 'published'), isNull(jobs.clerkId)))

    return {
      rows: rawRows.map((r) => ({
        id: r.id,
        inspectionType: r.inspectionType as InspectionType,
        scheduledDate: r.scheduledDate,
        preferredTimeSlot: r.preferredTimeSlot,
        status: r.status,
        serviceTier: r.serviceTier,
        clerkPayout: r.clerkPayout,
        createdByName: r.createdByName,
        property: r.propAddressLine1
          ? {
              addressLine1: r.propAddressLine1,
              city: r.propCity,
              postcode: r.propPostcode,
              propertyType: r.propType,
              bedrooms: r.propBedrooms,
              furnishedStatus: r.propFurnished,
            }
          : null,
      })),
      availableCount: Number(availableCount ?? 0),
    }
  })
}

function buildWhere(
  clerkId: string,
  f: ClerkJobsFilter
): SQL<unknown> | undefined {
  const clauses: Array<SQL<unknown>> = [
    eq(jobs.clerkId, clerkId),
    not(eq(jobs.status, 'cancelled')),
  ]
  if (f.status === 'pending') {
    clauses.push(inArray(jobs.status, [...PENDING_STATUSES]))
  } else if (f.status === 'in_progress') {
    clauses.push(inArray(jobs.status, [...IN_PROGRESS_STATUSES]))
  } else if (f.status === 'completed') {
    clauses.push(inArray(jobs.status, [...COMPLETED_STATUSES]))
  }
  if (f.from) clauses.push(gte(jobs.scheduledDate, f.from))
  if (f.to) clauses.push(lte(jobs.scheduledDate, f.to))
  return and(...clauses)
}

export function parseClerkJobsFilter(
  sp: Record<string, string | string[] | undefined>
): ClerkJobsFilter {
  const f: ClerkJobsFilter = {}
  const status = first(sp.status)
  if (status === 'pending' || status === 'in_progress' || status === 'completed') {
    f.status = status
  }
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

export const STATUS_TONE: Record<
  string,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  accepted: 'default',
  assigned: 'default',
  in_progress: 'default',
  submitted: 'secondary',
  reviewed: 'secondary',
  signed: 'secondary',
  completed: 'secondary',
  paid: 'secondary',
  published: 'outline',
  pending: 'outline',
  cancelled: 'destructive',
}
