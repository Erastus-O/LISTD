import { proEligibility } from '@/lib/listd/pro-levels'
import 'server-only'
import { and, asc, eq, gte, inArray, isNull, lte, sql, type SQL } from 'drizzle-orm'
import { db, jobs, profiles, properties } from '@/db'
import { buildCoverageMatcher } from '@/lib/coverage-radius'
import { signPropertyPhotos } from '@/lib/property/photo'
import {
  INSPECTION_TYPES,
  parseClerkPayoutLines,
  type ClerkPayoutLine,
  type InspectionType,
} from '@/lib/pricing-matrix'

/**
 * Server-only data layer for the clerk Available Jobs queue. Returns the
 * shortlist of `published` jobs not yet claimed by any clerk, filtered by
 * the calling clerk's `coverage_areas` (postcode-district prefix match) and
 * `service_types_offered` (inspection-type whitelist).
 *
 * Repeat detection: a job is `isRepeat` when the same `property_id` has at
 * least one `completed` job in history. This drives the small "Repeat" pill
 * on the card so the clerk knows what they're walking into.
 */

export type AvailableJobsFilter = {
  type?: InspectionType
  postcode?: string
  from?: string
  to?: string
  sort?: 'date_asc' | 'pay_desc' | 'posted_desc'
}

export type AvailableJobRow = {
  id: string
  inspectionType: InspectionType
  /** Every service on the booking. A client can bundle Inventory +
   *  Check-In into ONE job (see `/api/jobs/create`), and until now the
   *  feeds only ever printed `inspectionType` — the first of them — so a
   *  bundled check-in was invisible to the Pro deciding whether to accept.
   *  Empty for legacy rows written before the array column existed. */
  inspectionTypes: string[]
  scheduledDate: string
  preferredTimeSlot: string | null
  serviceTier: string
  clerkPayout: string | null
  /** Itemised clerk-pay lines (base service + per-feature add-ons) so the
   *  clerk can see what makes up the payout. Empty for legacy jobs. */
  payoutLines: ClerkPayoutLine[]
  specialInstructions: string | null
  shortNoticeSurcharge: boolean
  createdAt: string
  property: {
    id: string
    postcode: string | null
    city: string | null
    propertyType: string
    /** 0039 — flat / house / …, null on properties booked before the
     *  field existed. */
    dwellingType: string | null
    bedrooms: number
    furnishedStatus: string
    /** Freshly signed thumbnail URL (private bucket), or null when the
     *  client didn't add a photo. Never the stored public-form URL — that
     *  404s against a private bucket. */
    imageUrl: string | null
  }
  isRepeat: boolean
}

export type AvailableJobsData = {
  rows: AvailableJobRow[]
  /** Distinct postcode districts (e.g. "BS6") across the unfiltered shortlist. */
  postcodeDistricts: string[]
  /** Empty when the clerk has no coverage areas set, signalling the view to
   *  show a different empty-state hint. */
  coverageAreas: string[]
  serviceTypes: string[]
  /** Total `published` + clerk-less jobs in the system, ignoring the
   *  caller's coverage / service-type filters. Drives the "X jobs in
   *  the system don't match your coverage" diagnostic on the empty state. */
  totalUnclaimed: number
  /** Count after service-type filter applied but before coverage filter
   *  applied — distinguishes "service-type mismatch" from "coverage mismatch". */
  serviceTypeMatched: number
  /** Distinct postcode districts across the *full* unclaimed pool (not just
   *  what the clerk can see). Renders as a hint so the clerk can decide
   *  whether to expand their coverage. */
  unmatchedDistricts: string[]
}

export async function loadAvailableJobs(
  clerkId: string,
  filter: AvailableJobsFilter = {}
): Promise<AvailableJobsData> {
  return db.transaction(async (tx) => {
    const [profile] = await tx
      .select({
        coverageAreas: profiles.coverageAreas,
        serviceTypes: profiles.serviceTypesOffered,
      })
      .from(profiles)
      .where(eq(profiles.userId, clerkId))
      .limit(1)
    const coverageAreas = (profile?.coverageAreas ?? []).filter(Boolean)
    const serviceTypes = (profile?.serviceTypes ?? []).filter(Boolean)

    const where = buildWhere(filter, serviceTypes)

    const rawRows = await tx
      .select({
        id: jobs.id,
        inspectionType: jobs.inspectionType,
        requiredLevel: jobs.requiredLevel,
        inspectionTypes: jobs.inspectionTypes,
        scheduledDate: jobs.scheduledDate,
        preferredTimeSlot: jobs.preferredTimeSlot,
        serviceTier: jobs.serviceTier,
        clerkPayout: jobs.clerkPayout,
        clerkPayoutBreakdown: jobs.clerkPayoutBreakdown,
        specialInstructions: jobs.specialInstructions,
        shortNoticeSurcharge: jobs.shortNoticeSurchargeApplied,
        createdAt: jobs.createdAt,
        propertyId: properties.id,
        postcode: properties.postcode,
        city: properties.city,
        propertyType: properties.propertyType,
        dwellingType: properties.dwellingType,
        bedrooms: properties.bedrooms,
        furnishedStatus: properties.furnishedStatus,
        imageUrl: properties.imageUrl,
      })
      .from(jobs)
      .innerJoin(properties, eq(properties.id, jobs.propertyId))
      .where(where)
      .orderBy(asc(jobs.scheduledDate))

    // Coverage filter is done in JS. Full-postcode coverage entries cover a
    // 25 km radius (geocoded + cached); district/area entries keep the exact
    // district semantics ("BS6" → "BS6 7SA"; "BS1" does NOT match "BS14").
    // See lib/coverage.ts + lib/coverage-radius.ts.
    const matcher =
      coverageAreas.length === 0
        ? null
        : await buildCoverageMatcher(
            rawRows.map((r) => r.postcode),
            [coverageAreas]
          )
    const coverageMatched = matcher
      ? rawRows.filter((r) => matcher(r.postcode, coverageAreas))
      : rawRows
    // Only jobs this Pro's roles and levels allow. The accept route checks again.
    const canTake = await proEligibility(tx, clerkId)
    const filteredByCoverage = coverageMatched.filter((r) =>
      canTake({ inspectionType: r.inspectionType, requiredLevel: r.requiredLevel, bedrooms: r.bedrooms })
    )

    // Repeat detection — pull `completed` jobs scoped to the same property
    // set in one round-trip, build a Set, annotate.
    const propertyIds = Array.from(
      new Set(filteredByCoverage.map((r) => r.propertyId))
    )
    const repeatRows =
      propertyIds.length === 0
        ? []
        : await tx
            .select({ propertyId: jobs.propertyId })
            .from(jobs)
            .where(
              and(
                eq(jobs.status, 'completed'),
                inArray(jobs.propertyId, propertyIds)
              )
            )
    const repeatSet = new Set(
      repeatRows.map((r) => r.propertyId).filter((id): id is string => Boolean(id))
    )

    // Thumbnails: sign once per distinct photo, only for the rows this
    // clerk can actually see (post-coverage), so an unmatched job never
    // costs a storage round-trip.
    const signedPhotos = await signPropertyPhotos(
      filteredByCoverage.map((r) => r.imageUrl)
    )

    const rows: AvailableJobRow[] = filteredByCoverage.map((r) => ({
      id: r.id,
      inspectionType: r.inspectionType as InspectionType,
      inspectionTypes: r.inspectionTypes ?? [],
      scheduledDate: r.scheduledDate,
      preferredTimeSlot: r.preferredTimeSlot,
      serviceTier: r.serviceTier,
      clerkPayout: r.clerkPayout,
      payoutLines: parseClerkPayoutLines(r.clerkPayoutBreakdown),
      specialInstructions: r.specialInstructions,
      shortNoticeSurcharge: r.shortNoticeSurcharge,
      createdAt: r.createdAt,
      property: {
        id: r.propertyId,
        postcode: r.postcode,
        city: r.city,
        propertyType: r.propertyType,
        dwellingType: r.dwellingType,
        bedrooms: r.bedrooms,
        furnishedStatus: r.furnishedStatus,
        imageUrl: r.imageUrl ? (signedPhotos.get(r.imageUrl) ?? null) : null,
      },
      isRepeat: repeatSet.has(r.propertyId),
    }))

    // Postcode filter (post-coverage so the dropdown lists only districts
    // visible to this clerk). Sort applied last.
    const postcodeFiltered = filter.postcode
      ? rows.filter(
          (r) =>
            r.property.postcode?.split(' ')[0]?.toUpperCase() ===
            filter.postcode!.toUpperCase()
        )
      : rows

    const sorted = sortRows(postcodeFiltered, filter.sort ?? 'date_asc')

    const postcodeDistricts = Array.from(
      new Set(
        rows
          .map((r) => r.property.postcode?.split(' ')[0]?.toUpperCase())
          .filter((d): d is string => Boolean(d))
      )
    ).sort()

    // Diagnostics — total unclaimed pool ignoring this clerk's filters,
    // plus the postcode districts in that pool. Lets the empty-state UI
    // show "5 jobs in the system, none in your coverage" instead of a
    // generic "nothing here".
    const allUnclaimed = await tx
      .select({
        inspectionType: jobs.inspectionType,
        postcode: properties.postcode,
      })
      .from(jobs)
      .innerJoin(properties, eq(properties.id, jobs.propertyId))
      .where(
        and(
          eq(jobs.status, 'published'),
          isNull(jobs.clerkId),
          sql`${jobs.inspectionType} NOT LIKE 'clean\\_%'`
        )
      )
    const totalUnclaimed = allUnclaimed.length
    const validServiceTypes = serviceTypes.filter((t) =>
      (INSPECTION_TYPES as readonly string[]).includes(t)
    )
    const serviceTypeMatched =
      validServiceTypes.length === 0
        ? totalUnclaimed
        : allUnclaimed.filter((j) =>
            validServiceTypes.includes(j.inspectionType)
          ).length
    const unmatchedDistricts = Array.from(
      new Set(
        allUnclaimed
          .map((j) => j.postcode?.split(' ')[0]?.toUpperCase())
          .filter((d): d is string => Boolean(d))
      )
    ).sort()

    return {
      rows: sorted,
      postcodeDistricts,
      coverageAreas,
      serviceTypes,
      totalUnclaimed,
      serviceTypeMatched,
      unmatchedDistricts,
    }
  })
}

function buildWhere(
  f: AvailableJobsFilter,
  serviceTypes: string[]
): SQL<unknown> | undefined {
  const clauses: Array<SQL<unknown>> = [
    eq(jobs.status, 'published'),
    isNull(jobs.clerkId),
    // Cleaning jobs (clean_light/general/deep) belong to the cleaner
    // marketplace, not the clerk feed — exclude them even when a clerk has
    // no service-type whitelist set (which otherwise skips the type filter).
    sql`${jobs.inspectionType} NOT LIKE 'clean\\_%'`,
  ]
  if (f.type) {
    clauses.push(eq(jobs.inspectionType, f.type))
  } else if (serviceTypes.length > 0) {
    // Honour the clerk's service-types whitelist — only show jobs they're
    // signed up to do. If they have nothing set, show every type so they
    // can still bid (matches Lovable's behaviour when offered is empty).
    const validTypes = serviceTypes.filter((t) =>
      (INSPECTION_TYPES as readonly string[]).includes(t)
    ) as InspectionType[]
    if (validTypes.length > 0) {
      clauses.push(inArray(jobs.inspectionType, validTypes))
    }
  }
  if (f.from) clauses.push(gte(jobs.scheduledDate, f.from))
  if (f.to) clauses.push(lte(jobs.scheduledDate, f.to))
  return and(...clauses)
}

function sortRows(
  rows: AvailableJobRow[],
  sort: NonNullable<AvailableJobsFilter['sort']>
): AvailableJobRow[] {
  const out = [...rows]
  switch (sort) {
    case 'pay_desc':
      out.sort(
        (a, b) => Number(b.clerkPayout ?? 0) - Number(a.clerkPayout ?? 0)
      )
      break
    case 'posted_desc':
      out.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      break
    case 'date_asc':
    default:
      out.sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate))
      break
  }
  return out
}

export function parseAvailableJobsFilter(
  sp: Record<string, string | string[] | undefined>
): AvailableJobsFilter {
  const f: AvailableJobsFilter = {}
  const type = first(sp.type)
  if (type && (INSPECTION_TYPES as readonly string[]).includes(type)) {
    f.type = type as InspectionType
  }
  const postcode = first(sp.postcode)
  if (postcode) f.postcode = postcode
  const from = first(sp.from)
  if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) f.from = from
  const to = first(sp.to)
  if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) f.to = to
  const sort = first(sp.sort)
  if (
    sort === 'date_asc' ||
    sort === 'pay_desc' ||
    sort === 'posted_desc'
  ) {
    f.sort = sort
  }
  return f
}

function first(v: string | string[] | undefined): string | undefined {
  if (!v) return undefined
  return Array.isArray(v) ? v[0] : v
}
