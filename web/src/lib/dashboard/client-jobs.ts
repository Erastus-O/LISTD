import 'server-only'
import {
  and,
  asc,
  count,
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
import {
  db,
  jobs,
  organisationMembers,
  profiles,
  properties,
  type DB,
} from '@/db'

/**
 * Server-only data layer for the client Jobs list (M1 #14). All filters are
 * URL-driven so the page is shareable and the heavy work stays server-side.
 */

const INSPECTION_TYPES = [
  'new_inventory',
  'check_in',
  'check_out',
  'mid_term',
  'interim',
] as const
export type InspectionType = (typeof INSPECTION_TYPES)[number]

const JOB_STATUSES = [
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
export type JobStatus = (typeof JOB_STATUSES)[number]

export type JobsFilter = {
  q?: string
  type?: InspectionType
  status?: JobStatus
  clerkId?: string
  teamMemberId?: string
  from?: string
  to?: string
}

export type JobRow = {
  id: string
  status: string
  inspectionType: string
  scheduledDate: string
  address: string | null
  postcode: string | null
  clerkId: string | null
  clerkName: string | null
  createdByName: string | null
  quotedPrice: string | null
}

export type JobsPageData = {
  rows: JobRow[]
  total: number
  filterOptions: {
    teamMembers: Array<{ userId: string; name: string }>
    clerks: Array<{ userId: string; name: string }>
  }
}

const PAGE_SIZE = 50

export async function loadClientJobs(
  userId: string,
  filter: JobsFilter
): Promise<JobsPageData> {
  return db.transaction(async (tx) => {
    const where = buildWhere(userId, filter)

    const rows = await tx
      .select({
        id: jobs.id,
        status: jobs.status,
        inspectionType: jobs.inspectionType,
        scheduledDate: jobs.scheduledDate,
        clerkId: jobs.clerkId,
        createdByName: jobs.createdByName,
        quotedPrice: jobs.quotedPrice,
        addressLine1: properties.addressLine1,
        city: properties.city,
        postcode: properties.postcode,
      })
      .from(jobs)
      .leftJoin(properties, eq(jobs.propertyId, properties.id))
      .where(where)
      .orderBy(desc(jobs.scheduledDate))
      .limit(PAGE_SIZE)

    const [totalRow] = await tx
      .select({ c: count(jobs.id) })
      .from(jobs)
      .leftJoin(properties, eq(jobs.propertyId, properties.id))
      .where(where)
    const total = totalRow?.c ?? 0

    // Resolve clerk names for the visible rows in one query.
    const clerkIds = Array.from(
      new Set(rows.map((r) => r.clerkId).filter((c): c is string => Boolean(c)))
    )
    const clerkRows =
      clerkIds.length === 0
        ? []
        : await tx
            .select({ userId: profiles.userId, fullName: profiles.fullName })
            .from(profiles)
            .where(inArray(profiles.userId, clerkIds))
    const clerkNameById = new Map(
      clerkRows.map((c) => [c.userId, c.fullName ?? null])
    )

    const filterOptions = await loadFilterOptions(tx, userId)

    return {
      rows: rows.map((r) => ({
        id: r.id,
        status: r.status,
        inspectionType: r.inspectionType,
        scheduledDate: r.scheduledDate,
        address:
          r.addressLine1 && r.city ? `${r.addressLine1}, ${r.city}` : null,
        postcode: r.postcode ?? null,
        clerkId: r.clerkId ?? null,
        clerkName: r.clerkId ? clerkNameById.get(r.clerkId) ?? null : null,
        createdByName: r.createdByName ?? null,
        quotedPrice: r.quotedPrice ?? null,
      })),
      total,
      filterOptions,
    }
  })
}

function buildWhere(userId: string, f: JobsFilter): SQL<unknown> | undefined {
  const clauses: Array<SQL<unknown>> = [eq(jobs.clientId, userId)]

  if (f.type) clauses.push(eq(jobs.inspectionType, f.type))
  if (f.status) clauses.push(eq(jobs.status, f.status))
  if (f.clerkId) clauses.push(eq(jobs.clerkId, f.clerkId))
  if (f.teamMemberId) clauses.push(eq(jobs.createdByUserId, f.teamMemberId))
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

  return clauses.length > 0 ? and(...clauses) : undefined
}

/**
 * Filter dropdown options:
 *   - team members = other people in the same organisation as the user
 *   - clerks = distinct clerks who have worked at least one job for this client
 *
 * Both lists are stable enough to load alongside every page render.
 */
async function loadFilterOptions(
  tx: Parameters<Parameters<DB['transaction']>[0]>[0],
  userId: string
) {
  // Team members: anyone in the same org, including self.
  const [myMembership] = await tx
    .select({ organisationId: organisationMembers.organisationId })
    .from(organisationMembers)
    .where(
      and(
        eq(organisationMembers.userId, userId),
        eq(organisationMembers.status, 'active')
      )
    )
    .limit(1)

  const teamRows = myMembership?.organisationId
    ? await tx
        .select({ userId: organisationMembers.userId })
        .from(organisationMembers)
        .where(
          and(
            eq(organisationMembers.organisationId, myMembership.organisationId),
            eq(organisationMembers.status, 'active')
          )
        )
    : []

  const teamUserIds = teamRows.map((r) => r.userId)
  const teamProfiles =
    teamUserIds.length === 0
      ? []
      : await tx
          .select({ userId: profiles.userId, fullName: profiles.fullName })
          .from(profiles)
          .where(inArray(profiles.userId, teamUserIds))
          .orderBy(asc(profiles.fullName))

  // Distinct clerks who have worked for this client.
  const distinctClerks = await tx
    .selectDistinct({ clerkId: jobs.clerkId })
    .from(jobs)
    .where(and(eq(jobs.clientId, userId), isNotNull(jobs.clerkId)))

  const clerkIds = distinctClerks
    .map((r) => r.clerkId)
    .filter((c): c is string => Boolean(c))
  const clerkProfiles =
    clerkIds.length === 0
      ? []
      : await tx
          .select({ userId: profiles.userId, fullName: profiles.fullName })
          .from(profiles)
          .where(inArray(profiles.userId, clerkIds))
          .orderBy(asc(profiles.fullName))

  return {
    teamMembers: teamProfiles.map((t) => ({
      userId: t.userId,
      name: t.fullName ?? '(no name)',
    })),
    clerks: clerkProfiles.map((c) => ({
      userId: c.userId,
      name: c.fullName ?? '(no name)',
    })),
  }
}

/**
 * Parse loose query params (Next's `searchParams`) into the strict filter
 * shape. Drops anything unrecognised so the URL surface is stable.
 */
export function parseJobsFilter(
  sp: Record<string, string | string[] | undefined>
): JobsFilter {
  const f: JobsFilter = {}
  const type = first(sp.type)
  if (type && (INSPECTION_TYPES as readonly string[]).includes(type)) {
    f.type = type as InspectionType
  }
  const status = first(sp.status)
  if (status && (JOB_STATUSES as readonly string[]).includes(status)) {
    f.status = status as JobStatus
  }
  const q = first(sp.q)
  if (q) f.q = q
  const clerkId = first(sp.clerkId)
  if (clerkId) f.clerkId = clerkId
  const teamMemberId = first(sp.teamMemberId)
  if (teamMemberId) f.teamMemberId = teamMemberId
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
