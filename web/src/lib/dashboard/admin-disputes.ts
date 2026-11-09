import 'server-only'
import { asc, desc, eq, inArray, sql, type SQL } from 'drizzle-orm'
import {
  db,
  disputes,
  jobs,
  profiles,
  properties,
  userRoles,
} from '@/db'

/**
 * Server-only data layer for the admin Disputes pages (S6d-2). Listd-NEXT's
 * `disputes` schema is leaner than Lovable's: there's no `raised_by_role`,
 * `clerk_pay_decision`, or `clerk_pay_amount`. Roles are inferred at
 * read-time via `user_roles` lookup; pay-decision logic is deferred until
 * the schema migration lands.
 */

const STATUS_VALUES = [
  'open',
  'under_review',
  'resolved',
  'escalated',
] as const
export type DisputeStatus = (typeof STATUS_VALUES)[number]

const PAGE_SIZE = 25

export type AdminDisputesFilter = {
  status?: DisputeStatus | 'all'
  page?: number
}

export type AdminDisputesData = {
  rows: AdminDisputeListRow[]
  total: number
  page: number
  pageSize: number
}

export type AdminDisputeListRow = {
  id: string
  jobId: string
  status: string
  reason: string
  createdAt: string
  raisedBy: {
    userId: string
    fullName: string | null
    role: string | null
  }
  raisedAgainst: {
    userId: string
    fullName: string | null
  }
  property: {
    addressLine1: string | null
    postcode: string | null
  } | null
}

export async function loadAdminDisputesList(
  filter: AdminDisputesFilter = {}
): Promise<AdminDisputesData> {
  const page = Math.max(0, filter.page ?? 0)
  const offset = page * PAGE_SIZE
  return db.transaction(async (tx) => {
    const where = buildListWhere(filter)
    const rows = await tx
      .select({
        id: disputes.id,
        jobId: disputes.jobId,
        status: disputes.status,
        reason: disputes.reason,
        createdAt: disputes.createdAt,
        raisedBy: disputes.raisedBy,
        raisedAgainst: disputes.raisedAgainst,
        propAddress: properties.addressLine1,
        propPostcode: properties.postcode,
      })
      .from(disputes)
      .leftJoin(jobs, eq(jobs.id, disputes.jobId))
      .leftJoin(properties, eq(properties.id, jobs.propertyId))
      .where(where)
      .orderBy(desc(disputes.createdAt))
      .limit(PAGE_SIZE)
      .offset(offset)

    const [{ count }] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(disputes)
      .where(where)

    if (rows.length === 0) {
      return { rows: [], total: count ?? 0, page, pageSize: PAGE_SIZE }
    }

    const userIds = Array.from(
      new Set([
        ...rows.map((r) => r.raisedBy),
        ...rows.map((r) => r.raisedAgainst),
      ])
    )
    const profileRows = await tx
      .select({ userId: profiles.userId, fullName: profiles.fullName })
      .from(profiles)
      .where(inArray(profiles.userId, userIds))
    const nameMap = new Map(profileRows.map((p) => [p.userId, p.fullName]))

    const roleRows = await tx
      .select({ userId: userRoles.userId, role: userRoles.role })
      .from(userRoles)
      .where(inArray(userRoles.userId, userIds))
    // A user may carry multiple roles (admin + client); pick the most
    // role-domain-relevant for dispute context: clerk > client > other.
    const rolePriority = (r: string) =>
      r === 'clerk' ? 0 : r === 'client' ? 1 : 2
    const roleMap = new Map<string, string>()
    for (const r of roleRows) {
      const prev = roleMap.get(r.userId)
      if (!prev || rolePriority(r.role) < rolePriority(prev)) {
        roleMap.set(r.userId, r.role)
      }
    }

    return {
      rows: rows.map((r) => ({
        id: r.id,
        jobId: r.jobId,
        status: r.status,
        reason: r.reason,
        createdAt: r.createdAt,
        raisedBy: {
          userId: r.raisedBy,
          fullName: nameMap.get(r.raisedBy) ?? null,
          role: roleMap.get(r.raisedBy) ?? null,
        },
        raisedAgainst: {
          userId: r.raisedAgainst,
          fullName: nameMap.get(r.raisedAgainst) ?? null,
        },
        property: r.propAddress
          ? { addressLine1: r.propAddress, postcode: r.propPostcode }
          : null,
      })),
      total: count ?? 0,
      page,
      pageSize: PAGE_SIZE,
    }
  })
}

function buildListWhere(f: AdminDisputesFilter): SQL<unknown> | undefined {
  if (!f.status || f.status === 'all') return undefined
  return eq(disputes.status, f.status)
}

export type AdminDisputeDetail = {
  dispute: {
    id: string
    jobId: string
    status: string
    reason: string
    description: string | null
    resolution: string | null
    adminNotes: string | null
    resolvedBy: string | null
    resolvedAt: string | null
    createdAt: string
    updatedAt: string
    raisedBy: { userId: string; fullName: string | null; role: string | null }
    raisedAgainst: { userId: string; fullName: string | null; role: string | null }
  }
  job: {
    id: string
    inspectionType: string
    status: string
    scheduledDate: string
    clientId: string
    clerkId: string | null
  } | null
  property: {
    addressLine1: string | null
    city: string | null
    postcode: string | null
  } | null
  resolverName: string | null
}

export async function loadAdminDisputeDetail(
  disputeId: string
): Promise<AdminDisputeDetail | null> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        id: disputes.id,
        jobId: disputes.jobId,
        status: disputes.status,
        reason: disputes.reason,
        description: disputes.description,
        resolution: disputes.resolution,
        adminNotes: disputes.adminNotes,
        resolvedBy: disputes.resolvedBy,
        resolvedAt: disputes.resolvedAt,
        createdAt: disputes.createdAt,
        updatedAt: disputes.updatedAt,
        raisedBy: disputes.raisedBy,
        raisedAgainst: disputes.raisedAgainst,
        jobInspectionType: jobs.inspectionType,
        jobStatus: jobs.status,
        jobScheduledDate: jobs.scheduledDate,
        jobClientId: jobs.clientId,
        jobClerkId: jobs.clerkId,
        propAddress: properties.addressLine1,
        propCity: properties.city,
        propPostcode: properties.postcode,
      })
      .from(disputes)
      .leftJoin(jobs, eq(jobs.id, disputes.jobId))
      .leftJoin(properties, eq(properties.id, jobs.propertyId))
      .where(eq(disputes.id, disputeId))
      .limit(1)
    if (!row) return null

    const userIds = [row.raisedBy, row.raisedAgainst]
    if (row.resolvedBy) userIds.push(row.resolvedBy)

    const profileRows = await tx
      .select({ userId: profiles.userId, fullName: profiles.fullName })
      .from(profiles)
      .where(inArray(profiles.userId, userIds))
    const nameMap = new Map(profileRows.map((p) => [p.userId, p.fullName]))

    const roleRows = await tx
      .select({ userId: userRoles.userId, role: userRoles.role })
      .from(userRoles)
      .where(inArray(userRoles.userId, userIds))
      .orderBy(asc(userRoles.role))
    const rolePriority = (r: string) =>
      r === 'clerk' ? 0 : r === 'client' ? 1 : 2
    const roleMap = new Map<string, string>()
    for (const r of roleRows) {
      const prev = roleMap.get(r.userId)
      if (!prev || rolePriority(r.role) < rolePriority(prev)) {
        roleMap.set(r.userId, r.role)
      }
    }

    return {
      dispute: {
        id: row.id,
        jobId: row.jobId,
        status: row.status,
        reason: row.reason,
        description: row.description,
        resolution: row.resolution,
        adminNotes: row.adminNotes,
        resolvedBy: row.resolvedBy,
        resolvedAt: row.resolvedAt,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        raisedBy: {
          userId: row.raisedBy,
          fullName: nameMap.get(row.raisedBy) ?? null,
          role: roleMap.get(row.raisedBy) ?? null,
        },
        raisedAgainst: {
          userId: row.raisedAgainst,
          fullName: nameMap.get(row.raisedAgainst) ?? null,
          role: roleMap.get(row.raisedAgainst) ?? null,
        },
      },
      job: row.jobInspectionType
        ? {
            id: row.jobId,
            inspectionType: row.jobInspectionType,
            status: row.jobStatus ?? 'unknown',
            scheduledDate: row.jobScheduledDate ?? '',
            clientId: row.jobClientId ?? '',
            clerkId: row.jobClerkId,
          }
        : null,
      property: row.propAddress
        ? {
            addressLine1: row.propAddress,
            city: row.propCity,
            postcode: row.propPostcode,
          }
        : null,
      resolverName: row.resolvedBy
        ? nameMap.get(row.resolvedBy) ?? null
        : null,
    }
  })
}

export const DISPUTE_STATUSES = STATUS_VALUES

export function parseAdminDisputesFilter(
  sp: Record<string, string | string[] | undefined>
): AdminDisputesFilter {
  const f: AdminDisputesFilter = {}
  const status = first(sp.status)
  if (
    status === 'all' ||
    (status && (STATUS_VALUES as readonly string[]).includes(status))
  ) {
    f.status = status as AdminDisputesFilter['status']
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

export const DISPUTE_BADGE_TONE: Record<
  string,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  open: 'destructive',
  under_review: 'default',
  resolved: 'secondary',
  escalated: 'destructive',
}
