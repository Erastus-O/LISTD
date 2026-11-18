import 'server-only'
import { and, asc, eq, inArray, isNull, ne, sql } from 'drizzle-orm'
import {
  jobMessages,
  jobs,
  notifications,
  organisationMembers,
  profiles,
  properties,
  reviews,
  tenantDetails,
  userRoles,
  withServiceRole,
  type Tx,
} from '@/db'
import { escapeHtml } from '@/lib/api'
import { logAuditEvent } from '@/lib/audit'
import { notifyUserSms } from '@/lib/notify-prefs'
import { sendPushToUser } from '@/lib/push'
import { FROM_NOTIFICATIONS, getResend, logEmail } from '@/lib/resend'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { emailPrimaryTenantSlotRequest } from '@/lib/tenant-slot-request'
import type { QuoteLine } from './pricing'
import { getProLevel } from './pro-levels'
import { autoApproves, getProWorkflow } from './pro-workflow'
import { currentQuote } from './quotes'
import { SERVICE_LABEL, roleForType, serviceFromType } from './services'

/**
 * LISTD approval of a Pro's accept.
 *
 *   Pro accepts  -> job is `accepted`, listd_approved_at NULL: "awaiting LISTD".
 *                   The Pro sees the area, date, spec and their net, never the
 *                   address, access codes or contacts, and can't start.
 *   LISTD approves (or the Pro's level meets the auto-approve setting)
 *                -> details unlock, the brief goes to the Pro (in-app message,
 *                   notification, email), the client hears a Pro is booked.
 *   LISTD declines -> the job goes back on the board for another Pro.
 */

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://app.listd.co.uk'
const ref = (id: string) => id.slice(0, 8)

/** True while the job waits for LISTD. Admins always see everything. */
export function awaitingListd(job: { status: string; listdApprovedAt: string | null }): boolean {
  return !job.listdApprovedAt && (job.status === 'accepted' || job.status === 'assigned')
}

/** Where the Pro works on this job. Trades jobs live under the clerk area. */
export function proJobPath(inspectionType: string, jobId: string): string {
  return roleForType(inspectionType) === 'CLEANER' ? `/cleaner/jobs/${jobId}` : `/clerk/jobs/${jobId}`
}

export type ApprovalEffects = {
  jobId: string
  proId: string
  clientIds: string[]
  addr: string
  serviceLabel: string
  brief: string
  /** The Pro's job page, relative to the site. */
  proPath: string
}

/**
 * Call inside the accept transaction, after the claim. Approves straight away
 * when the setting allows it for this Pro's level; otherwise queues the job for
 * LISTD. Returns effects to run after commit when it was approved.
 */
export async function afterProAccept(tx: Tx, p: { jobId: string; proId: string; inspectionType: string }) {
  const workflow = await getProWorkflow()
  const level = await getProLevel(tx, p.proId, roleForType(p.inspectionType))
  if (autoApproves(workflow, level)) {
    const effects = await approveInTx(tx, { jobId: p.jobId, actorId: null, mode: 'auto' })
    return { approved: true as const, effects }
  }

  const admins = await tx.select({ userId: userRoles.userId }).from(userRoles).where(eq(userRoles.role, 'admin'))
  const label = SERVICE_LABEL[serviceFromType(p.inspectionType)]
  await tx.insert(notifications).values([
    ...[...new Set(admins.map((a) => a.userId))].map((userId) => ({
      userId,
      type: 'job',
      title: 'Approval needed',
      message: `A Pro accepted ${label} job ${ref(p.jobId)}. Approve it to send them the brief.`,
      link: `/admin/jobs/${p.jobId}`,
    })),
    {
      userId: p.proId,
      type: 'job',
      title: 'Waiting for LISTD approval',
      message: `Thanks for accepting job ${ref(p.jobId)}. LISTD checks every booking during the beta. You’ll get the address, access details and brief once it’s approved.`,
      link: proJobPath(p.inspectionType, p.jobId),
    },
  ])
  return { approved: false as const, effects: null }
}

/** LISTD approves. Null when the job isn't waiting (already approved, cancelled, reassigned). */
export async function approveInTx(
  tx: Tx,
  p: { jobId: string; actorId: string | null; mode: 'manual' | 'auto' }
): Promise<ApprovalEffects | null> {
  const [job] = await tx
    .update(jobs)
    .set({
      listdApprovedAt: sql`now()`,
      listdApprovedBy: p.actorId,
      listdApprovalMode: p.mode,
      briefSentAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(and(eq(jobs.id, p.jobId), isNull(jobs.listdApprovedAt), inArray(jobs.status, ['accepted', 'assigned'])))
    .returning({
      id: jobs.id,
      clientId: jobs.clientId,
      organisationId: jobs.organisationId,
      clerkId: jobs.clerkId,
      cleanerId: jobs.cleanerId,
      inspectionType: jobs.inspectionType,
      propertyId: jobs.propertyId,
      scheduledDate: jobs.scheduledDate,
      scheduledAt: jobs.scheduledAt,
      preferredTimeSlot: jobs.preferredTimeSlot,
      accessMethod: jobs.accessMethod,
      accessCollection: jobs.accessCollection,
      accessParkingNotes: jobs.accessParkingNotes,
      specialInstructions: jobs.specialInstructions,
      scope: jobs.scope,
      clerkPayout: jobs.clerkPayout,
      cleanerPayout: jobs.cleanerPayout,
    })
  if (!job) return null
  const proId = (roleForType(job.inspectionType) === 'CLEANER' ? job.cleanerId : job.clerkId) ?? job.clerkId ?? job.cleanerId
  if (!proId) return null

  const [prop] = job.propertyId
    ? await tx
        .select({ a1: properties.addressLine1, a2: properties.addressLine2, city: properties.city, postcode: properties.postcode })
        .from(properties)
        .where(eq(properties.id, job.propertyId))
        .limit(1)
    : [null]
  const addr = [prop?.a1, prop?.a2, prop?.city, prop?.postcode].filter(Boolean).join(', ') || 'Address on the job page'
  const tenants = await tx
    .select({ name: tenantDetails.fullName, phone: tenantDetails.phone, email: tenantDetails.email })
    .from(tenantDetails)
    .where(eq(tenantDetails.jobId, job.id))
    .orderBy(asc(tenantDetails.tenantOrder))
  const q = await currentQuote(tx, job.id)
  const workflow = await getProWorkflow()
  const serviceLabel = SERVICE_LABEL[serviceFromType(job.inspectionType)]
  const netP = Math.round(Number((roleForType(job.inspectionType) === 'CLEANER' ? job.cleanerPayout : job.clerkPayout) ?? 0) * 100)

  const when = job.scheduledAt
    ? new Date(job.scheduledAt).toLocaleString('en-GB', { timeZone: 'Europe/London', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    : `${job.scheduledDate}${job.preferredTimeSlot ? `, ${job.preferredTimeSlot}` : ''}`
  const spec = ((q?.lines as QuoteLine[] | undefined) ?? []).map((l) => `- ${l.d}${l.q > 1 ? ` x ${l.q}` : ''}`)
  const access = [
    job.accessMethod && `Access: ${job.accessMethod}`,
    job.accessCollection && `Keys: ${job.accessCollection}`,
    job.accessParkingNotes && `Parking: ${job.accessParkingNotes}`,
    job.specialInstructions && `Client notes and codes: ${job.specialInstructions}`,
  ].filter(Boolean)
  const contacts = tenants.map((t) => `- ${[t.name, t.phone, t.email].filter(Boolean).join(', ')}`)

  const brief = [
    `Approved: ${serviceLabel}, job ${ref(job.id)}`,
    '',
    `Address: ${addr}`,
    `When: ${when}`,
    `You earn: £${(netP / 100).toFixed(2)}`,
    ...(access.length ? ['', ...access] : []),
    ...(contacts.length ? ['', 'On-site contacts:', ...contacts] : []),
    ...(spec.length ? ['', 'Job spec:', ...spec] : []),
    '',
    'Platform rules:',
    ...workflow.platformRules.split('\n').filter((l) => l.trim()).map((l) => `- ${l.trim()}`),
  ].join('\n')

  await tx.insert(jobMessages).values({ jobId: job.id, channel: 'pro', senderId: null, senderSide: 'system', body: brief.slice(0, 4000) })

  const clientIds = new Set<string>([job.clientId])
  if (job.organisationId) {
    const owners = await tx
      .select({ userId: organisationMembers.userId })
      .from(organisationMembers)
      .where(
        and(
          eq(organisationMembers.organisationId, job.organisationId),
          eq(organisationMembers.orgRole, 'owner'),
          eq(organisationMembers.status, 'active'),
          ne(organisationMembers.userId, job.clientId)
        )
      )
    for (const o of owners) clientIds.add(o.userId)
  }
  const arrival = job.scheduledAt ? ` Arrival ${when}.` : ''
  await tx.insert(notifications).values([
    {
      userId: proId,
      type: 'job',
      title: 'Job approved: your brief is ready',
      message: `${serviceLabel} at ${addr}. Address, access details and the job spec are on the job page.`,
      link: proJobPath(job.inspectionType, job.id),
    },
    ...[...clientIds].map((userId) => ({
      userId,
      type: 'job',
      title: 'Pro booked',
      message: `A verified LISTD Pro is booked for job ${ref(job.id)} at ${prop?.a1 ?? 'your property'}.${arrival}`,
      link: `/client/jobs/${job.id}`,
    })),
  ])
  await logAuditEvent(tx, {
    category: 'job_lifecycle',
    action: 'job.listd_approved',
    actorUserId: p.actorId,
    targetType: 'job',
    targetId: job.id,
    payload: { mode: p.mode, proId },
  })
  return { jobId: job.id, proId, clientIds: [...clientIds], addr, serviceLabel, brief, proPath: proJobPath(job.inspectionType, job.id) }
}

/** LISTD declines the Pro: the job goes back on the board. */
export async function declineAcceptInTx(tx: Tx, p: { jobId: string; actorId: string; reason: string }) {
  const [before] = await tx
    .select({ clerkId: jobs.clerkId, cleanerId: jobs.cleanerId, inspectionType: jobs.inspectionType })
    .from(jobs)
    .where(and(eq(jobs.id, p.jobId), isNull(jobs.listdApprovedAt), inArray(jobs.status, ['accepted', 'assigned'])))
    .limit(1)
  if (!before) return { ok: false as const, error: 'This job is not waiting for approval.' }
  const proId = before.clerkId ?? before.cleanerId
  await tx
    .update(jobs)
    .set({ status: 'published', clerkId: null, cleanerId: null, acceptedAt: null, scheduledAt: null, updatedAt: sql`now()` })
    .where(eq(jobs.id, p.jobId))
  if (proId) {
    await tx.insert(notifications).values({
      userId: proId,
      type: 'job',
      title: 'Booking not approved',
      message: `LISTD didn’t approve job ${ref(p.jobId)} for you this time. ${p.reason}`,
      link: roleForType(before.inspectionType) === 'CLEANER' ? '/cleaner/jobs/available' : '/clerk/jobs/available',
    })
  }
  await logAuditEvent(tx, {
    category: 'job_lifecycle',
    action: 'job.listd_declined',
    actorUserId: p.actorId,
    targetType: 'job',
    targetId: p.jobId,
    payload: { proId, reason: p.reason },
  })
  return { ok: true as const, proId }
}

/** After commit: SMS and push to the client, push and email the brief to the Pro, tenant slot email. Best-effort. */
export async function runApprovalEffects(e: ApprovalEffects, actorId: string | null) {
  const clientUrl = (id: string) => `${SITE_URL}/client/jobs/${id}`
  await Promise.allSettled([
    ...e.clientIds.map((userId) =>
      notifyUserSms(userId, 'smsJobUpdates', `LISTD: A verified Pro is booked for ${e.serviceLabel} at ${e.addr}. ${clientUrl(e.jobId)}`)
    ),
    ...e.clientIds.map((userId) =>
      sendPushToUser(userId, { title: 'Pro booked', body: `${e.serviceLabel} at ${e.addr}`, url: `/client/jobs/${e.jobId}`, tag: `job:${e.jobId}:approved` })
    ),
    sendPushToUser(e.proId, { title: 'Job approved', body: `Your brief for ${e.addr} is ready.`, url: e.proPath, tag: `job:${e.jobId}:approved` }),
    emailBrief(e),
    emailPrimaryTenantSlotRequest({ jobId: e.jobId, issuedBy: actorId ?? e.proId }),
  ])
}

async function emailBrief(e: ApprovalEffects) {
  if (!process.env.RESEND_API_KEY) return
  const { data } = await getSupabaseAdmin().auth.admin.getUserById(e.proId)
  const to = data.user?.email
  if (!to) return
  const subject = `Approved: ${e.serviceLabel} at ${e.addr}`
  const html = `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5;color:#111">
<pre style="font-family:inherit;white-space:pre-wrap">${escapeHtml(e.brief)}</pre>
<p><a href="${SITE_URL}${e.proPath}">Open the job</a></p></div>`
  let resendId: string | null = null
  let errorMessage: string | null = null
  try {
    const r = await getResend().emails.send({ from: FROM_NOTIFICATIONS, to: [to], subject, html })
    resendId = r.data?.id ?? null
    errorMessage = r.error?.message ?? null
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : String(err)
  }
  await logEmail({ functionName: 'job-brief', recipientEmails: [to], subject, resendId, errorMessage, metadata: { jobId: e.jobId } })
}

/** What the admin approval panel needs. Null when the job isn't waiting for LISTD. */
export async function loadApprovalInfo(jobId: string) {
  return withServiceRole(async (tx) => {
    const [job] = await tx
      .select({
        status: jobs.status,
        listdApprovedAt: jobs.listdApprovedAt,
        acceptedAt: jobs.acceptedAt,
        clerkId: jobs.clerkId,
        cleanerId: jobs.cleanerId,
        inspectionType: jobs.inspectionType,
        clerkPayout: jobs.clerkPayout,
        cleanerPayout: jobs.cleanerPayout,
      })
      .from(jobs)
      .where(eq(jobs.id, jobId))
      .limit(1)
    if (!job || !awaitingListd(job)) return null
    const isClean = roleForType(job.inspectionType) === 'CLEANER'
    const proId = (isClean ? job.cleanerId : job.clerkId) ?? job.clerkId ?? job.cleanerId
    const netP = Math.round(Number((isClean ? job.cleanerPayout : job.clerkPayout) ?? 0) * 100)
    if (!proId) return { acceptedAt: job.acceptedAt, netP, pro: null }
    const [p] = await tx
      .select({ name: profiles.fullName, verification: profiles.verificationStatus })
      .from(profiles)
      .where(eq(profiles.userId, proId))
      .limit(1)
    const role = roleForType(job.inspectionType)
    const level = await getProLevel(tx, proId, role)
    const [stats] = await tx
      .select({
        completed: sql<number>`count(*) filter (where ${jobs.status} in ('completed', 'paid'))::int`,
      })
      .from(jobs)
      .where(sql`${jobs.clerkId} = ${proId} or ${jobs.cleanerId} = ${proId}`)
    const [rating] = await tx
      .select({ avg: sql<number | null>`avg(${reviews.rating})::float` })
      .from(reviews)
      .where(eq(reviews.revieweeId, proId))
    return {
      acceptedAt: job.acceptedAt,
      netP,
      pro: {
        userId: proId,
        name: p?.name ?? null,
        verification: p?.verification ?? null,
        level,
        completed: stats?.completed ?? 0,
        rating: rating?.avg ?? null,
      },
    }
  })
}

/** Admin queue: every accepted job waiting for LISTD, oldest first. */
export async function loadApprovalQueue() {
  return withServiceRole(async (tx) => {
    const rows = await tx
      .select({
        id: jobs.id,
        inspectionType: jobs.inspectionType,
        scheduledDate: jobs.scheduledDate,
        acceptedAt: jobs.acceptedAt,
        postcode: properties.postcode,
        proName: profiles.fullName,
        proVerification: profiles.verificationStatus,
        clerkPayout: jobs.clerkPayout,
        cleanerPayout: jobs.cleanerPayout,
      })
      .from(jobs)
      .leftJoin(properties, eq(properties.id, jobs.propertyId))
      .leftJoin(profiles, sql`${profiles.userId} = coalesce(${jobs.cleanerId}, ${jobs.clerkId})`)
      .where(and(isNull(jobs.listdApprovedAt), inArray(jobs.status, ['accepted', 'assigned'])))
      .orderBy(asc(jobs.acceptedAt))
    return rows.map((r) => ({
      ...r,
      serviceLabel: SERVICE_LABEL[serviceFromType(r.inspectionType)],
      netP: Math.round(Number((roleForType(r.inspectionType) === 'CLEANER' ? r.cleanerPayout : r.clerkPayout) ?? 0) * 100),
    }))
  })
}
