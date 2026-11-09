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
import {
  db,
  invoices,
  jobs,
  notificationPreferences,
  organisationMembers,
  organisations,
  profiles,
  properties,
  userRoles,
} from '@/db'
import { getSupabaseAdmin } from '@/lib/supabase/admin'

/**
 * Server-only data layer for the admin Clients pages (S6d of the Lovable
 * port). Mirrors `useAdminClientsList` / `useAdminClientDetail` but moves
 * the shape to Drizzle joins + URL-driven filters.
 *
 * Email is fetched from the Supabase auth API in a single
 * `auth.admin.listUsers` batch (perPage 1000) rather than per-row — keeps
 * a 25-client page render to one auth round-trip. Larger user bases (>1000)
 * will need pagination through `listUsers` or a denormalised `email` column
 * on `profiles`.
 */

const PAGE_SIZE = 25
const AUTH_USERS_BATCH = 1000

export type AdminClientStatus = 'active' | 'suspended' | 'deleted'

export type AdminClientsFilter = {
  q?: string
  status?: AdminClientStatus
  orgId?: string
  page?: number
}

export type AdminClientListRow = {
  userId: string
  fullName: string | null
  companyName: string | null
  phone: string | null
  email: string | null
  organisation: { id: string; name: string | null } | null
  jobsCount: number
  status: AdminClientStatus
  lastActiveAt: string | null
  createdAt: string
}

export type AdminClientsListData = {
  rows: AdminClientListRow[]
  total: number
  page: number
  pageSize: number
  /** Distinct active orgs across the full client set — populates the Org filter. */
  orgOptions: Array<{ id: string; name: string }>
}

export async function loadAdminClientsList(
  filter: AdminClientsFilter
): Promise<AdminClientsListData> {
  const offset = (filter.page ?? 0) * PAGE_SIZE

  // Org filter joins on organisation_members; the page query needs to know
  // which userIds are members of the requested org. We compute that ID set
  // up-front so we can include it in `baseFilter` for both the page query
  // and the count query.
  const orgFilterUserIds: string[] | null = filter.orgId
    ? await db
        .select({ userId: organisationMembers.userId })
        .from(organisationMembers)
        .where(
          and(
            eq(organisationMembers.organisationId, filter.orgId),
            eq(organisationMembers.status, 'active')
          )
        )
        .then((rs) => rs.map((r) => r.userId))
    : null

  return db.transaction(async (tx) => {
    const baseFilter = buildClientWhere(filter, orgFilterUserIds)

    // Two-phase load to avoid join fan-out: a user with multiple active
    // `organisation_members` rows would otherwise produce duplicate rows
    // (and duplicate React keys) when the org join is included in the page
    // query. Step 1 pages distinct profile rows; step 2 looks up org
    // membership for that page's userIds.
    const profileRows = await tx
      .select({
        userId: profiles.userId,
        fullName: profiles.fullName,
        companyName: profiles.companyName,
        phone: profiles.phone,
        accountStatus: profiles.accountStatus,
        createdAt: profiles.createdAt,
        jobsCount: sql<number>`(
          select count(*)::int from ${jobs} where ${jobs.clientId} = ${profiles.userId}
        )`,
      })
      .from(profiles)
      .innerJoin(userRoles, eq(userRoles.userId, profiles.userId))
      .where(and(eq(userRoles.role, 'client'), baseFilter))
      .orderBy(desc(profiles.createdAt))
      .limit(PAGE_SIZE)
      .offset(offset)

    // Distinct count — `userRoles` may carry multiple rows per user (a
    // `client` row plus e.g. an `admin` row), so we filter on role and
    // count distinct userId to avoid double-counting in pagination math.
    const [{ count }] = await tx
      .select({
        count: sql<number>`count(distinct ${profiles.userId})::int`,
      })
      .from(profiles)
      .innerJoin(userRoles, eq(userRoles.userId, profiles.userId))
      .where(and(eq(userRoles.role, 'client'), baseFilter))

    // Step 2: org membership for the page's userIds. Pick one membership
    // per user (the most recent active row) since a single client may
    // legitimately belong to multiple orgs but the list view shows just one.
    const userIds = profileRows.map((r) => r.userId)
    const orgRows =
      userIds.length === 0
        ? []
        : await tx
            .select({
              userId: organisationMembers.userId,
              organisationId: organisations.id,
              organisationName: organisations.name,
              lastActiveAt: organisationMembers.lastActiveAt,
              createdAt: organisationMembers.createdAt,
            })
            .from(organisationMembers)
            .leftJoin(
              organisations,
              eq(organisations.id, organisationMembers.organisationId)
            )
            .where(
              and(
                inArray(organisationMembers.userId, userIds),
                eq(organisationMembers.status, 'active')
              )
            )
            .orderBy(desc(organisationMembers.createdAt))
    // First-seen wins (rows already ordered by createdAt desc) — most-recent
    // active membership becomes the displayed one. Capture lastActiveAt
    // alongside so the row can show it (falls back to profile.createdAt).
    const orgMap = new Map<
      string,
      { id: string; name: string | null; lastActiveAt: string | null }
    >()
    for (const o of orgRows) {
      if (!o.organisationId) continue
      if (!orgMap.has(o.userId)) {
        orgMap.set(o.userId, {
          id: o.organisationId,
          name: o.organisationName,
          lastActiveAt: o.lastActiveAt,
        })
      }
    }

    // Distinct active orgs across the *full* client set (independent of the
    // current filter) so the dropdown always shows every option.
    const orgOptionRows = await tx
      .selectDistinct({
        id: organisations.id,
        name: organisations.name,
      })
      .from(organisationMembers)
      .innerJoin(
        organisations,
        eq(organisations.id, organisationMembers.organisationId)
      )
      .innerJoin(
        userRoles,
        and(
          eq(userRoles.userId, organisationMembers.userId),
          eq(userRoles.role, 'client')
        )
      )
      .where(eq(organisationMembers.status, 'active'))
      .orderBy(asc(organisations.name))
    const orgOptions = orgOptionRows
      .filter((o): o is { id: string; name: string } => Boolean(o.name))
      .map((o) => ({ id: o.id, name: o.name }))

    // Email batch from auth.admin — single round-trip up to 1000 users.
    // For deployments past that, switch to per-row getUserById or
    // denormalise email onto profiles.
    const emailMap = await loadEmailMap()

    return {
      rows: profileRows.map((r) => {
        const org = orgMap.get(r.userId) ?? null
        return {
          userId: r.userId,
          fullName: r.fullName,
          companyName: r.companyName,
          phone: r.phone,
          email: emailMap.get(r.userId) ?? null,
          organisation: org
            ? { id: org.id, name: org.name }
            : null,
          jobsCount: Number(r.jobsCount ?? 0),
          status: (r.accountStatus ?? 'active') as AdminClientStatus,
          lastActiveAt: org?.lastActiveAt ?? null,
          createdAt: r.createdAt,
        }
      }),
      total: count ?? 0,
      page: filter.page ?? 0,
      pageSize: PAGE_SIZE,
      orgOptions,
    }
  })
}

function buildClientWhere(
  f: AdminClientsFilter,
  orgFilterUserIds: string[] | null
): SQL<unknown> | undefined {
  const clauses: Array<SQL<unknown>> = []
  if (f.q && f.q.trim()) {
    const like = `%${f.q.trim()}%`
    const search = or(
      ilike(profiles.fullName, like),
      ilike(profiles.companyName, like),
      ilike(profiles.phone, like)
    )
    if (search) clauses.push(search)
  }
  if (f.status) {
    clauses.push(eq(profiles.accountStatus, f.status))
  }
  if (orgFilterUserIds !== null) {
    if (orgFilterUserIds.length === 0) {
      // Org has no client members — short-circuit to an empty result.
      clauses.push(sql`1 = 0`)
    } else {
      clauses.push(inArray(profiles.userId, orgFilterUserIds))
    }
  }
  if (clauses.length === 0) return undefined
  return and(...clauses)
}

/**
 * One-shot batch of every auth user's email. Returns a Map keyed by userId.
 * Falls back to an empty map if the auth admin call throws — emails just
 * render as `—` in that case.
 */
async function loadEmailMap(): Promise<Map<string, string>> {
  try {
    const supabaseAdmin = getSupabaseAdmin()
    const res = await supabaseAdmin.auth.admin.listUsers({
      perPage: AUTH_USERS_BATCH,
    })
    if (res.error) return new Map()
    const map = new Map<string, string>()
    for (const u of res.data?.users ?? []) {
      if (u.email) map.set(u.id, u.email)
    }
    return map
  } catch {
    return new Map()
  }
}

export type AdminClientDetail = {
  userId: string
  fullName: string | null
  companyName: string | null
  phone: string | null
  email: string | null
  isSuperAdmin: boolean
  accountStatus: AdminClientStatus
  deletedAt: string | null
  createdAt: string
  /** Admin-only working notes on this client (`profiles.admin_notes`,
   *  added in migration 0007). Distinct from any per-job admin notes. */
  adminNotes: string | null
  /** Public URL of the client's profile photo (`profiles.avatar_url`). */
  avatarUrl: string | null
  organisation: {
    id: string
    name: string | null
    billingAddress: string | null
    vatNumber: string | null
  } | null
  organisationMembers: Array<{
    membershipId: string
    userId: string
    fullName: string | null
    orgRole: string
    status: string
    lastActiveAt: string | null
  }>
  recentJobs: Array<{
    id: string
    inspectionType: string
    status: string
    scheduledDate: string
    quotedPrice: string | null
    propertyAddress: string | null
    clerkFullName: string | null
  }>
  notificationPreferences: Array<{ key: string; enabled: boolean }>
  /** The client's invoices from the local `invoices` table (most recent
   *  first, capped). Provider-agnostic: Xero invoices are mirrored locally
   *  with `xeroInvoiceId` set, so this shows them too. */
  invoices: Array<{
    id: string
    reference: string | null
    status: string
    kind: string
    issueDate: string | null
    dueDate: string | null
    total: string
    paidTotal: string
    currency: string
  }>
}

export async function loadAdminClientDetail(
  clientId: string
): Promise<AdminClientDetail | null> {
  const supabaseAdmin = getSupabaseAdmin()

  return db.transaction(async (tx) => {
    const [profile] = await tx
      .select({
        userId: profiles.userId,
        fullName: profiles.fullName,
        companyName: profiles.companyName,
        phone: profiles.phone,
        isSuperAdmin: profiles.isSuperAdmin,
        accountStatus: profiles.accountStatus,
        deletedAt: profiles.deletedAt,
        createdAt: profiles.createdAt,
        adminNotes: profiles.adminNotes,
        avatarUrl: profiles.avatarUrl,
      })
      .from(profiles)
      .where(eq(profiles.userId, clientId))
      .limit(1)
    if (!profile) return null

    const [orgMembership] = await tx
      .select({
        organisationId: organisationMembers.organisationId,
        orgRole: organisationMembers.orgRole,
        organisationName: organisations.name,
        billingAddress: organisations.billingAddress,
        vatNumber: organisations.vatNumber,
      })
      .from(organisationMembers)
      .leftJoin(
        organisations,
        eq(organisations.id, organisationMembers.organisationId)
      )
      .where(
        and(
          eq(organisationMembers.userId, clientId),
          eq(organisationMembers.status, 'active')
        )
      )
      .limit(1)

    const orgMembers = orgMembership
      ? await tx
          .select({
            membershipId: organisationMembers.id,
            userId: organisationMembers.userId,
            orgRole: organisationMembers.orgRole,
            status: organisationMembers.status,
            lastActiveAt: organisationMembers.lastActiveAt,
            fullName: profiles.fullName,
          })
          .from(organisationMembers)
          .leftJoin(profiles, eq(profiles.userId, organisationMembers.userId))
          .where(eq(organisationMembers.organisationId, orgMembership.organisationId))
          .orderBy(asc(profiles.fullName))
      : []

    const recentJobsRows = await tx
      .select({
        id: jobs.id,
        inspectionType: jobs.inspectionType,
        status: jobs.status,
        scheduledDate: jobs.scheduledDate,
        quotedPrice: jobs.quotedPrice,
        propertyId: jobs.propertyId,
        clerkId: jobs.clerkId,
      })
      .from(jobs)
      .where(eq(jobs.clientId, clientId))
      .orderBy(desc(jobs.createdAt))
      .limit(50)

    const propertyIds = Array.from(
      new Set(
        recentJobsRows
          .map((j) => j.propertyId)
          .filter((id): id is string => Boolean(id))
      )
    )
    const clerkIds = Array.from(
      new Set(
        recentJobsRows
          .map((j) => j.clerkId)
          .filter((id): id is string => Boolean(id))
      )
    )
    const [propertyRows, clerkRows] = await Promise.all([
      propertyIds.length === 0
        ? Promise.resolve([] as Array<{ id: string; addressLine1: string | null }>)
        : tx
            .select({
              id: properties.id,
              addressLine1: properties.addressLine1,
            })
            .from(properties)
            .where(inArray(properties.id, propertyIds)),
      clerkIds.length === 0
        ? Promise.resolve([] as Array<{ userId: string; fullName: string | null }>)
        : tx
            .select({
              userId: profiles.userId,
              fullName: profiles.fullName,
            })
            .from(profiles)
            .where(inArray(profiles.userId, clerkIds)),
    ])
    const propertyMap = new Map(
      propertyRows.map((p) => [p.id, p.addressLine1 ?? null])
    )
    const clerkMap = new Map(
      clerkRows.map((c) => [c.userId, c.fullName ?? null])
    )

    const invoiceRows = await tx
      .select({
        id: invoices.id,
        reference: invoices.reference,
        status: invoices.status,
        kind: invoices.kind,
        issueDate: invoices.issueDate,
        dueDate: invoices.dueDate,
        total: invoices.total,
        paidTotal: invoices.paidTotal,
        currency: invoices.currency,
      })
      .from(invoices)
      .where(eq(invoices.clientId, clientId))
      .orderBy(desc(invoices.createdAt))
      .limit(20)

    const [prefs] = await tx
      .select()
      .from(notificationPreferences)
      .where(eq(notificationPreferences.userId, clientId))
      .limit(1)
    const prefList = prefs
      ? Object.entries(prefs)
          .filter(
            ([k, v]) =>
              !['id', 'userId', 'createdAt', 'updatedAt'].includes(k) &&
              typeof v === 'boolean'
          )
          .map(([key, val]) => ({ key, enabled: val as boolean }))
      : []

    // Email from Supabase auth (not in `profiles`). One admin call per detail
    // page render — cheap. Surface null if the call fails so the UI degrades
    // gracefully rather than 500ing the whole page.
    let email: string | null = null
    try {
      const res = await supabaseAdmin.auth.admin.getUserById(clientId)
      email = res.data?.user?.email ?? null
    } catch {
      email = null
    }

    return {
      userId: profile.userId,
      fullName: profile.fullName,
      companyName: profile.companyName,
      phone: profile.phone,
      email,
      isSuperAdmin: profile.isSuperAdmin,
      accountStatus: (profile.accountStatus ?? 'active') as AdminClientStatus,
      deletedAt: profile.deletedAt,
      createdAt: profile.createdAt,
      adminNotes: profile.adminNotes,
      avatarUrl: profile.avatarUrl,
      organisation: orgMembership
        ? {
            id: orgMembership.organisationId,
            name: orgMembership.organisationName,
            billingAddress: orgMembership.billingAddress,
            vatNumber: orgMembership.vatNumber,
          }
        : null,
      organisationMembers: orgMembers.map((m) => ({
        membershipId: m.membershipId,
        userId: m.userId,
        fullName: m.fullName,
        orgRole: m.orgRole,
        status: m.status,
        lastActiveAt: m.lastActiveAt,
      })),
      recentJobs: recentJobsRows.map((j) => ({
        id: j.id,
        inspectionType: j.inspectionType,
        status: j.status,
        scheduledDate: j.scheduledDate,
        quotedPrice: j.quotedPrice,
        propertyAddress: j.propertyId
          ? propertyMap.get(j.propertyId) ?? null
          : null,
        clerkFullName: j.clerkId ? clerkMap.get(j.clerkId) ?? null : null,
      })),
      notificationPreferences: prefList,
      invoices: invoiceRows,
    }
  })
}

const STATUS_VALUES: AdminClientStatus[] = ['active', 'suspended', 'deleted']

export function parseAdminClientsFilter(
  sp: Record<string, string | string[] | undefined>
): AdminClientsFilter {
  const f: AdminClientsFilter = {}
  const q = first(sp.q)
  if (q) f.q = q
  const status = first(sp.status)
  if (status && (STATUS_VALUES as readonly string[]).includes(status)) {
    f.status = status as AdminClientStatus
  }
  const orgId = first(sp.orgId)
  if (orgId) f.orgId = orgId
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
