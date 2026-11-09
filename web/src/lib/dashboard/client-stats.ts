import 'server-only'
import { and, asc, count, desc, eq, gte, inArray, isNotNull, lte, sql } from 'drizzle-orm'
import { db, jobs, profiles, properties } from '@/db'
import { getEffectivePricing } from '@/lib/pricing-settings'
import {
  resolveSignoffPolicy,
  type CustomServiceType,
} from '@/lib/pricing-matrix'

/**
 * Server-only data layer for the client dashboard cards (M1 #15 / .lovable §7).
 *
 * Three queries kept inside a single tx so we don't open one pool connection
 * per card. The DAL has already verified the caller is a client; we filter by
 * `clientId = userId` explicitly here so even if RLS were bypassed the user
 * only sees their own rows.
 */

export type PendingActionItem = {
  jobId: string
  reason: 'draft' | 'awaiting_signoff' | 'awaiting_ack' | 'pre_inspection_ack'
  label: string
  scheduledDate: string | null
  address: string | null
}

export type UpcomingInspection = {
  jobId: string
  scheduledDate: string
  status: string
  inspectionType: string
  address: string | null
  clerkName: string | null
}

export type ReportFolderEntry = {
  propertyId: string
  address: string | null
  reportCount: number
  lastDeliveredAt: string | null
}

export type ClientDashboardCards = {
  pendingActions: PendingActionItem[]
  pendingActionsTotal: number
  upcoming: UpcomingInspection[]
  reportFolders: ReportFolderEntry[]
  reportFoldersTotal: number
}

/** Build the pending-action items from job rows (shared by the dashboard card
 *  and the full "/client/actions" list). */
function buildPendingActions(
  rows: Array<{
    jobId: string
    status: string
    inspectionType: string
    scheduledDate: string | null
    clientPreInspectionAck: boolean | null
    clientReportAccepted: boolean | null
    clientReportAcknowledgedAt: string | null
    addressLine1: string | null
    city: string | null
  }>,
  customTypes: CustomServiceType[]
): PendingActionItem[] {
  const actions: PendingActionItem[] = []
  for (const r of rows) {
    const address =
      r.addressLine1 && r.city ? `${r.addressLine1}, ${r.city}` : null
    if (r.status === 'draft') {
      actions.push({
        jobId: r.jobId,
        reason: 'draft',
        label: 'Finish booking : awaiting payment',
        scheduledDate: r.scheduledDate ?? null,
        address,
      })
    } else if (['submitted', 'reviewed'].includes(r.status)) {
      // Report delivered — the action depends on who signs this service.
      const policy = resolveSignoffPolicy(r.inspectionType, customTypes)
      if (policy.signoffBy === 'client' && !r.clientReportAccepted) {
        actions.push({
          jobId: r.jobId,
          reason: 'awaiting_signoff',
          label: 'Sign your report',
          scheduledDate: r.scheduledDate ?? null,
          address,
        })
      } else if (policy.clientAckRequired && !r.clientReportAcknowledgedAt) {
        actions.push({
          jobId: r.jobId,
          reason: 'awaiting_ack',
          label: 'Confirm you received the report',
          scheduledDate: r.scheduledDate ?? null,
          address,
        })
      }
    } else if (
      !r.clientPreInspectionAck &&
      ['published', 'accepted', 'assigned', 'in_progress'].includes(r.status)
    ) {
      actions.push({
        jobId: r.jobId,
        reason: 'pre_inspection_ack',
        label: 'Confirm tenant details & access instructions',
        scheduledDate: r.scheduledDate ?? null,
        address,
      })
    }
  }
  return actions
}

/**
 * Every pending action for a client (not capped) — powers the full
 * "/client/actions" view. Mirrors the dashboard card's logic exactly.
 */
export async function loadClientPendingActions(
  userId: string
): Promise<PendingActionItem[]> {
  try {
    return await loadClientPendingActionsInner(userId)
  } catch (err) {
    // Defensive: a pre-0033 database (missing the acknowledgement column)
    // must not break the dashboard / actions page. Degrade to "nothing
    // pending" until the migration is applied.
    console.warn('[client-stats] pending actions unavailable:', err)
    return []
  }
}

async function loadClientPendingActionsInner(
  userId: string
): Promise<PendingActionItem[]> {
  const [rows, pricing] = await Promise.all([
    db
      .select({
        jobId: jobs.id,
        status: jobs.status,
        inspectionType: jobs.inspectionType,
        scheduledDate: jobs.scheduledDate,
        clientPreInspectionAck: jobs.clientPreInspectionAck,
        clientReportAccepted: jobs.clientReportAccepted,
        clientReportAcknowledgedAt: jobs.clientReportAcknowledgedAt,
        addressLine1: properties.addressLine1,
        city: properties.city,
      })
      .from(jobs)
      .leftJoin(properties, eq(jobs.propertyId, properties.id))
      .where(
        and(
          eq(jobs.clientId, userId),
          inArray(jobs.status, [
            'draft',
            'submitted',
            'reviewed',
            'published',
            'accepted',
            'assigned',
            'in_progress',
          ])
        )
      )
      .orderBy(asc(jobs.scheduledDate))
      .limit(200),
    getEffectivePricing(),
  ])
  return buildPendingActions(rows, pricing.customTypes)
}

export async function loadClientDashboardCards(
  userId: string
): Promise<ClientDashboardCards> {
  const todayISO = new Date().toISOString().slice(0, 10)
  const next7ISO = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10)

  // Pending actions are loaded via the resilient standalone helper (which is
  // policy-aware and degrades gracefully on a pre-migration DB), then sliced
  // for the card. Upcoming + report folders stay in their own tx below.
  const allPending = await loadClientPendingActions(userId)
  const pendingActions = allPending.slice(0, 5)
  const pendingActionsTotal = allPending.length

  return db.transaction(async (tx) => {

    // ── Upcoming Inspections (next 7 days) ─────────────────────────────────
    const upcomingRows = await tx
      .select({
        jobId: jobs.id,
        scheduledDate: jobs.scheduledDate,
        status: jobs.status,
        inspectionType: jobs.inspectionType,
        clerkId: jobs.clerkId,
        addressLine1: properties.addressLine1,
        city: properties.city,
      })
      .from(jobs)
      .leftJoin(properties, eq(jobs.propertyId, properties.id))
      .where(
        and(
          eq(jobs.clientId, userId),
          gte(jobs.scheduledDate, todayISO),
          lte(jobs.scheduledDate, next7ISO),
          inArray(jobs.status, [
            'published',
            'accepted',
            'assigned',
            'in_progress',
          ])
        )
      )
      .orderBy(asc(jobs.scheduledDate))
      .limit(5)

    // Resolve clerk names in one shot.
    const clerkIds = Array.from(
      new Set(
        upcomingRows.map((r) => r.clerkId).filter((c): c is string => Boolean(c))
      )
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

    const upcoming: UpcomingInspection[] = upcomingRows.map((r) => ({
      jobId: r.jobId,
      scheduledDate: r.scheduledDate,
      status: r.status,
      inspectionType: r.inspectionType,
      address:
        r.addressLine1 && r.city ? `${r.addressLine1}, ${r.city}` : null,
      clerkName: r.clerkId ? clerkNameById.get(r.clerkId) ?? null : null,
    }))

    // ── Report Folders (groups by property) ────────────────────────────────
    // One row per property that has at least one delivered report; surface
    // the report count + most recent delivery.
    const folderRows = await tx
      .select({
        propertyId: jobs.propertyId,
        addressLine1: properties.addressLine1,
        city: properties.city,
        reportCount: count(jobs.id),
        lastDeliveredAt: sql<string>`max(${jobs.deliveredAt})`,
      })
      .from(jobs)
      .leftJoin(properties, eq(jobs.propertyId, properties.id))
      .where(
        and(
          eq(jobs.clientId, userId),
          isNotNull(jobs.reportUrl),
          inArray(jobs.status, ['submitted', 'reviewed', 'signed', 'completed', 'paid'])
        )
      )
      .groupBy(jobs.propertyId, properties.addressLine1, properties.city)
      .orderBy(desc(sql`max(${jobs.deliveredAt})`))
      .limit(4)

    const reportFolders: ReportFolderEntry[] = folderRows.map((r) => ({
      propertyId: r.propertyId,
      address:
        r.addressLine1 && r.city ? `${r.addressLine1}, ${r.city}` : null,
      reportCount: r.reportCount,
      lastDeliveredAt: r.lastDeliveredAt ?? null,
    }))

    // Total distinct properties with reports — used for the "View all" CTA.
    const [totalRow] = await tx
      .select({
        c: sql<number>`count(distinct ${jobs.propertyId})::int`,
      })
      .from(jobs)
      .where(
        and(
          eq(jobs.clientId, userId),
          isNotNull(jobs.reportUrl),
          inArray(jobs.status, ['submitted', 'reviewed', 'signed', 'completed', 'paid'])
        )
      )

    return {
      pendingActions,
      pendingActionsTotal,
      upcoming,
      reportFolders,
      reportFoldersTotal: totalRow?.c ?? 0,
    }
  })
}
