import { proEligibility } from '@/lib/listd/pro-levels'
import 'server-only'
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm'
import { db, jobs, profiles, properties } from '@/db'
import { buildCoverageMatcher } from '@/lib/coverage-radius'
import {
  cleanLevelFromType,
  cleaningLabelFromType,
  isCleaningType,
  type CleanLevel,
} from '@/lib/pricing-matrix'
import { getEffectivePricing } from '@/lib/pricing-settings'

/**
 * Server-only data layer for the cleaner job marketplace + my-jobs + detail.
 * Cleaning jobs are `jobs` rows with `inspection_type` = clean_light/general/
 * deep, assigned via `cleaner_id` (not `clerk_id`).
 */

const CLEAN_LIKE = sql`${jobs.inspectionType} LIKE 'clean\\_%'`

export type CleanerAvailableJob = {
  id: string
  level: CleanLevel | null
  /** Display label — resolves admin-defined offerings too. */
  label: string
  scheduledDate: string
  preferredTimeSlot: string | null
  cleanerPayout: string | null
  quotedPrice: string | null
  specialInstructions: string | null
  createdAt: string
  property: {
    postcode: string | null
    city: string | null
    propertyType: string
    bedrooms: number
  }
}

/** Published, unclaimed cleaning jobs within the cleaner's coverage areas. */
export async function loadCleanerAvailableJobs(
  cleanerId: string
): Promise<{ rows: CleanerAvailableJob[]; coverageAreas: string[] }> {
  return db.transaction(async (tx) => {
    const [profile] = await tx
      .select({ coverageAreas: profiles.coverageAreas })
      .from(profiles)
      .where(eq(profiles.userId, cleanerId))
      .limit(1)
    const coverageAreas = (profile?.coverageAreas ?? []).filter(Boolean)

    const raw = await tx
      .select({
        id: jobs.id,
        inspectionType: jobs.inspectionType,
        requiredLevel: jobs.requiredLevel,
        scheduledDate: jobs.scheduledDate,
        preferredTimeSlot: jobs.preferredTimeSlot,
        cleanerPayout: jobs.cleanerPayout,
        quotedPrice: jobs.quotedPrice,
        specialInstructions: jobs.specialInstructions,
        createdAt: jobs.createdAt,
        postcode: properties.postcode,
        city: properties.city,
        propertyType: properties.propertyType,
        bedrooms: properties.bedrooms,
      })
      .from(jobs)
      .innerJoin(properties, eq(properties.id, jobs.propertyId))
      .where(
        and(eq(jobs.status, 'published'), isNull(jobs.cleanerId), CLEAN_LIKE)
      )
      .orderBy(asc(jobs.scheduledDate))

    const matcher =
      coverageAreas.length === 0
        ? null
        : await buildCoverageMatcher(
            raw.map((r) => r.postcode),
            [coverageAreas]
          )
    const canTake = await proEligibility(tx, cleanerId)
    const filtered = (matcher ? raw.filter((r) => matcher(r.postcode, coverageAreas)) : raw).filter((r) =>
      canTake({ inspectionType: r.inspectionType, requiredLevel: r.requiredLevel, bedrooms: r.bedrooms })
    )

    // Rate card resolves labels for admin-defined offerings (cached).
    const { cleaning } = await getEffectivePricing()

    const rows: CleanerAvailableJob[] = filtered.map((r) => ({
      id: r.id,
      level: cleanLevelFromType(r.inspectionType),
      label: cleaningLabelFromType(r.inspectionType, cleaning) ?? 'Clean',
      scheduledDate: r.scheduledDate,
      preferredTimeSlot: r.preferredTimeSlot,
      cleanerPayout: r.cleanerPayout,
      quotedPrice: r.quotedPrice,
      specialInstructions: r.specialInstructions,
      createdAt: r.createdAt,
      property: {
        postcode: r.postcode,
        city: r.city,
        propertyType: r.propertyType,
        bedrooms: r.bedrooms,
      },
    }))
    return { rows, coverageAreas }
  })
}

export type CleanerJobRow = {
  id: string
  level: CleanLevel | null
  /** Display label — resolves admin-defined offerings too. */
  label: string
  status: string
  scheduledDate: string
  cleanerPayout: string | null
  cleanerFinalPayout: string | null
  property: { city: string | null; postcode: string | null; bedrooms: number }
}

/** The cleaner's own jobs (accepted → completed/paid). */
export async function loadCleanerJobs(cleanerId: string): Promise<CleanerJobRow[]> {
  const raw = await db
    .select({
      id: jobs.id,
      inspectionType: jobs.inspectionType,
      status: jobs.status,
      scheduledDate: jobs.scheduledDate,
      cleanerPayout: jobs.cleanerPayout,
      cleanerFinalPayout: jobs.cleanerFinalPayout,
      city: properties.city,
      postcode: properties.postcode,
      bedrooms: properties.bedrooms,
    })
    .from(jobs)
    .innerJoin(properties, eq(properties.id, jobs.propertyId))
    .where(eq(jobs.cleanerId, cleanerId))
    .orderBy(desc(jobs.scheduledDate))

  const { cleaning } = await getEffectivePricing()
  return raw.map((r) => ({
    id: r.id,
    level: cleanLevelFromType(r.inspectionType),
    label: cleaningLabelFromType(r.inspectionType, cleaning) ?? 'Clean',
    status: r.status,
    scheduledDate: r.scheduledDate,
    cleanerPayout: r.cleanerPayout,
    cleanerFinalPayout: r.cleanerFinalPayout,
    property: { city: r.city, postcode: r.postcode, bedrooms: r.bedrooms },
  }))
}

export type CleanerCompletion = {
  checkedTasks: number[]
  notes: string
  photos: string[]
  completedAt: string | null
}

export type CleanerJobDetail = {
  id: string
  level: CleanLevel | null
  /** Display label — resolves admin-defined offerings too. */
  label: string
  /** Raw `jobs.inspection_type` (drives the type-aware checklist). */
  inspectionType: string
  status: string
  scheduledDate: string
  preferredTimeSlot: string | null
  /** Exact confirmed arrival timestamp (UTC ISO) — set at accept. */
  scheduledAt: string | null
  cleanerPayout: string | null
  cleanerFinalPayout: string | null
  specialInstructions: string | null
  completion: CleanerCompletion | null
  property: {
    addressLine1: string
    addressLine2: string | null
    city: string
    postcode: string
    propertyType: string
    bedrooms: number
  } | null
}

/**
 * A single cleaning job the cleaner is assigned to (or admin viewing). Returns
 * null if the job isn't theirs / isn't a cleaning job.
 */
export async function loadCleanerJobDetail(
  jobId: string,
  cleanerId: string,
  isAdmin: boolean
): Promise<CleanerJobDetail | null> {
  const [row] = await db
    .select({
      id: jobs.id,
      cleanerId: jobs.cleanerId,
      inspectionType: jobs.inspectionType,
      status: jobs.status,
      scheduledDate: jobs.scheduledDate,
      preferredTimeSlot: jobs.preferredTimeSlot,
      scheduledAt: jobs.scheduledAt,
      cleanerPayout: jobs.cleanerPayout,
      cleanerFinalPayout: jobs.cleanerFinalPayout,
      specialInstructions: jobs.specialInstructions,
      cleaningChecklist: jobs.cleaningChecklist,
      propertyAddress1: properties.addressLine1,
      propertyAddress2: properties.addressLine2,
      propertyCity: properties.city,
      propertyPostcode: properties.postcode,
      propertyType: properties.propertyType,
      propertyBedrooms: properties.bedrooms,
    })
    .from(jobs)
    .leftJoin(properties, eq(properties.id, jobs.propertyId))
    .where(eq(jobs.id, jobId))
    .limit(1)

  if (!row) return null
  if (!isCleaningType(row.inspectionType)) return null // not a clean
  if (!isAdmin && row.cleanerId !== cleanerId) return null

  const { cleaning } = await getEffectivePricing()
  return {
    id: row.id,
    level: cleanLevelFromType(row.inspectionType),
    label: cleaningLabelFromType(row.inspectionType, cleaning) ?? 'Clean',
    inspectionType: row.inspectionType,
    status: row.status,
    scheduledDate: row.scheduledDate,
    preferredTimeSlot: row.preferredTimeSlot,
    scheduledAt: row.scheduledAt,
    cleanerPayout: row.cleanerPayout,
    cleanerFinalPayout: row.cleanerFinalPayout,
    specialInstructions: row.specialInstructions,
    completion: parseCompletion(row.cleaningChecklist),
    property: row.propertyAddress1
      ? {
          addressLine1: row.propertyAddress1 ?? '',
          addressLine2: row.propertyAddress2,
          city: row.propertyCity ?? '',
          postcode: row.propertyPostcode ?? '',
          propertyType: row.propertyType ?? '',
          bedrooms: row.propertyBedrooms ?? 0,
        }
      : null,
  }
}

/** Defensively read the cleaning_checklist jsonb. */
function parseCompletion(value: unknown): CleanerCompletion | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  if (!v.completedAt && !Array.isArray(v.checkedTasks)) return null
  return {
    checkedTasks: Array.isArray(v.checkedTasks)
      ? v.checkedTasks.filter((n): n is number => typeof n === 'number')
      : [],
    notes: typeof v.notes === 'string' ? v.notes : '',
    photos: Array.isArray(v.photos)
      ? v.photos.filter((p): p is string => typeof p === 'string')
      : [],
    completedAt: typeof v.completedAt === 'string' ? v.completedAt : null,
  }
}
