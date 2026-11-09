import 'server-only'
import { eq, or, sql } from 'drizzle-orm'
import {
  appLogs,
  auditEvents,
  clerkIncidents,
  clerkTelemetry,
  disputes,
  emailLogs,
  escrowTransactions,
  generatedReports,
  invoices,
  jobs,
  messages,
  notificationPreferences,
  notifications,
  organisationMembers,
  profiles,
  properties,
  pushSubscriptions,
  reports,
  reviews,
  smsLogs,
  strikes,
  tenantDetails,
  userRoles,
  waitlistLeads,
  withServiceRole,
  xeroConnections,
} from '@/db'
import { logAuditEvent } from '@/lib/audit'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { parseSupabaseStorageUrl } from '@/lib/storage/download'

/**
 * GDPR data-subject tooling: export (right of access / portability) and
 * erasure (right to be forgotten).
 *
 * A subject is either a platform **user** (uuid; client / clerk / cleaner) or a
 * non-user identified only by **email** (tenant, waitlist lead). Email lives in
 * Supabase Auth, not `profiles`.
 *
 * Erasure is conservative by design: it **anonymises** personal data in place
 * (preserving referential integrity and records LISTD must retain for legal /
 * tax reasons — invoices, escrow, audit) and **hard-deletes the genuinely
 * sensitive storage objects** (avatar, DBS/ID/insurance, signatures, optionally
 * inspection photos). Every erasure writes an audit row.
 */

export type Subject = { userId?: string | null; email?: string | null }

export type DsarExport = {
  generatedAt: string
  subject: { userId: string | null; email: string | null }
  auth: { email: string | null; createdAt: string | null; lastSignInAt: string | null } | null
  data: Record<string, unknown[]>
  storageObjects: Array<{ bucket: string; path: string; source: string }>
  notes: string[]
}

// ── Export ────────────────────────────────────────────────────────────────

/**
 * Collect everything we hold about a subject. Read-only. Returns a structured
 * bundle suitable for handing to the data subject (the "access" right).
 */
export async function exportSubjectData(subject: Subject): Promise<DsarExport> {
  const userId = subject.userId ?? null
  const email = subject.email ?? null
  const data: Record<string, unknown[]> = {}
  const storageObjects: DsarExport['storageObjects'] = []
  const notes: string[] = []

  // Auth record (email + timestamps) for a platform user.
  let auth: DsarExport['auth'] = null
  if (userId) {
    try {
      const admin = getSupabaseAdmin()
      const { data: u } = await admin.auth.admin.getUserById(userId)
      if (u?.user) {
        auth = {
          email: u.user.email ?? null,
          createdAt: u.user.created_at ?? null,
          lastSignInAt: u.user.last_sign_in_at ?? null,
        }
      }
    } catch (err) {
      notes.push(`auth lookup failed: ${err instanceof Error ? err.message : 'error'}`)
    }
  }

  const addStorage = (url: string | null | undefined, source: string) => {
    if (!url) return
    const parsed = parseSupabaseStorageUrl(url)
    if (parsed) storageObjects.push({ ...parsed, source })
  }

  await withServiceRole(async (tx) => {
    if (userId) {
      // Profile + roles + memberships.
      const profileRows = await tx
        .select()
        .from(profiles)
        .where(eq(profiles.userId, userId))
      data.profiles = profileRows
      for (const p of profileRows) {
        addStorage(p.avatarUrl, 'profiles.avatar_url')
        addStorage(p.dbsCertificateUrl, 'profiles.dbs_certificate_url')
        addStorage(p.governmentIdUrl, 'profiles.government_id_url')
      }
      data.user_roles = await tx
        .select()
        .from(userRoles)
        .where(eq(userRoles.userId, userId))
      data.organisation_members = await tx
        .select()
        .from(organisationMembers)
        .where(eq(organisationMembers.userId, userId))

      // Their properties + jobs (as client / worker / creator).
      data.properties = await tx
        .select()
        .from(properties)
        .where(eq(properties.clientId, userId))
      const jobRows = await tx
        .select()
        .from(jobs)
        .where(
          or(
            eq(jobs.clientId, userId),
            eq(jobs.clerkId, userId),
            eq(jobs.cleanerId, userId),
            eq(jobs.createdByUserId, userId)
          )
        )
      data.jobs = jobRows
      for (const j of jobRows) {
        addStorage(j.reportUrl, 'jobs.report_url')
        addStorage(j.clientSignatureUrl, 'jobs.client_signature_url')
      }

      // Reports they authored (clerk) + generated PDFs for their jobs.
      const reportRows = await tx
        .select()
        .from(reports)
        .where(eq(reports.clerkId, userId))
      data.reports = reportRows
      for (const r of reportRows) addStorage(r.pdfUrl, 'reports.pdf_url')

      // Reviews, messages, notifications, prefs, push subs.
      data.reviews = await tx
        .select()
        .from(reviews)
        .where(eq(reviews.reviewerId, userId))
      data.messages = await tx
        .select()
        .from(messages)
        .where(or(eq(messages.senderId, userId), eq(messages.recipientId, userId)))
      data.notifications = await tx
        .select()
        .from(notifications)
        .where(eq(notifications.userId, userId))
      data.notification_preferences = await tx
        .select()
        .from(notificationPreferences)
        .where(eq(notificationPreferences.userId, userId))
      data.push_subscriptions = await tx
        .select()
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.userId, userId))

      // Worker conduct + telemetry.
      data.clerk_incidents = await tx
        .select()
        .from(clerkIncidents)
        .where(eq(clerkIncidents.clerkId, userId))
      data.strikes = await tx
        .select()
        .from(strikes)
        .where(eq(strikes.clerkId, userId))
      data.clerk_telemetry = await tx
        .select()
        .from(clerkTelemetry)
        .where(eq(clerkTelemetry.clerkId, userId))

      // Financial (retained under legal basis; exported for transparency).
      data.invoices = await tx
        .select()
        .from(invoices)
        .where(eq(invoices.clientId, userId))
      data.escrow_transactions = await tx
        .select()
        .from(escrowTransactions)
        .where(
          or(
            eq(escrowTransactions.clientUserId, userId),
            eq(escrowTransactions.clerkId, userId)
          )
        )
      data.disputes = await tx
        .select()
        .from(disputes)
        .where(eq(disputes.raisedBy, userId))
      data.xero_connections = await tx
        .select()
        .from(xeroConnections)
        .where(eq(xeroConnections.userId, userId))

      // Activity / comms.
      data.audit_events = await tx
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.actorUserId, userId))
      data.app_logs = await tx
        .select()
        .from(appLogs)
        .where(eq(appLogs.actorUserId, userId))
      data.sms_logs = await tx
        .select()
        .from(smsLogs)
        .where(eq(smsLogs.recipientUserId, userId))
    }

    // Email-keyed records (tenants, leads, email logs) — also caught for users.
    const subjectEmail = email ?? auth?.email ?? null
    if (subjectEmail) {
      data.tenant_details = await tx
        .select()
        .from(tenantDetails)
        .where(eq(tenantDetails.email, subjectEmail))
      data.email_logs = await tx
        .select()
        .from(emailLogs)
        .where(eq(emailLogs.recipientEmail, subjectEmail))
      data.waitlist_leads = await tx
        .select()
        .from(waitlistLeads)
        .where(eq(waitlistLeads.email, subjectEmail))
    }
  })

  // Generated report PDFs tied to the subject's jobs.
  const jobIds = (data.jobs as Array<{ id: string }> | undefined)?.map((j) => j.id) ?? []
  if (jobIds.length) {
    await withServiceRole(async (tx) => {
      for (const jobId of jobIds) {
        const gr = await tx
          .select()
          .from(generatedReports)
          .where(eq(generatedReports.jobId, jobId))
        data.generated_reports = [...(data.generated_reports ?? []), ...gr]
        for (const g of gr) addStorage(g.reportUrl, 'generated_reports.report_url')
      }
    })
    notes.push(
      `Inspection photos for ${jobIds.length} job(s) live under the job-photos bucket keyed by job id (prefixes: ${jobIds
        .slice(0, 10)
        .join(', ')}${jobIds.length > 10 ? '…' : ''}).`
    )
  }

  return {
    generatedAt: new Date().toISOString(),
    subject: { userId, email },
    auth,
    data,
    storageObjects,
    notes,
  }
}

// ── Erasure ─────────────────────────────────────────────────────────────────

export type EraseOptions = {
  /** Also delete inspection photos for the subject's jobs (default false —
   *  photos may be part of a report retained under legal basis). */
  deletePhotos?: boolean
  /** Anonymise the Supabase Auth email too (default true). */
  anonymiseAuth?: boolean
}

export type EraseSummary = {
  subject: { userId: string | null; email: string | null }
  anonymised: Record<string, number>
  storageDeleted: string[]
  retained: string[]
  errors: string[]
}

const REDACTED = '[erased]'

/**
 * Erase a subject: anonymise PII in place, delete sensitive storage objects,
 * and audit the action. Financial / audit records are retained (de-identified
 * via the profile/tenant anonymisation) under the legal-obligation basis.
 */
export async function eraseSubjectData(
  subject: Subject,
  actorUserId: string,
  opts: EraseOptions = {}
): Promise<EraseSummary> {
  const userId = subject.userId ?? null
  const anonymised: Record<string, number> = {}
  const storageDeleted: string[] = []
  const errors: string[] = []
  const retained = [
    'invoices / invoice_payments (legal & tax retention)',
    'escrow_transactions (financial record)',
    'audit_events / app_logs (accountability; de-identified)',
  ]

  // Resolve the subject's email up front (auth or provided).
  let email = subject.email ?? null
  const admin = getSupabaseAdmin()
  if (userId && !email) {
    try {
      const { data: u } = await admin.auth.admin.getUserById(userId)
      email = u?.user?.email ?? null
    } catch {
      /* non-fatal */
    }
  }

  // Gather storage paths to delete BEFORE we null the URLs.
  const toDelete: Array<{ bucket: string; path: string }> = []
  const jobIds: string[] = []
  await withServiceRole(async (tx) => {
    if (userId) {
      const [p] = await tx
        .select()
        .from(profiles)
        .where(eq(profiles.userId, userId))
      for (const url of [p?.avatarUrl, p?.dbsCertificateUrl, p?.governmentIdUrl]) {
        const parsed = url ? parseSupabaseStorageUrl(url) : null
        if (parsed) toDelete.push(parsed)
      }
      const jrows = await tx
        .select({ id: jobs.id })
        .from(jobs)
        .where(
          or(
            eq(jobs.clientId, userId),
            eq(jobs.clerkId, userId),
            eq(jobs.cleanerId, userId),
            eq(jobs.createdByUserId, userId)
          )
        )
      jobIds.push(...jrows.map((j) => j.id))
    }
  })

  // ── Anonymise in the DB ──────────────────────────────────────────────────
  await withServiceRole(async (tx) => {
    if (userId) {
      const r1 = await tx
        .update(profiles)
        .set({
          fullName: REDACTED,
          companyName: null,
          phone: null,
          avatarUrl: null,
          dbsCertificateUrl: null,
          insuranceDetails: null,
          governmentIdUrl: null,
          emergencyContactName: null,
          emergencyContactPhone: null,
          updatedAt: sql`now()`,
        })
        .where(eq(profiles.userId, userId))
        .returning({ id: profiles.id })
      anonymised.profiles = r1.length

      const r2 = await tx
        .update(smsLogs)
        .set({ recipientPhone: REDACTED })
        .where(eq(smsLogs.recipientUserId, userId))
        .returning({ id: smsLogs.id })
      anonymised.sms_logs = r2.length
    }

    if (email) {
      const t = await tx
        .update(tenantDetails)
        .set({ fullName: REDACTED, email: null, phone: null, tenantToken: null })
        .where(eq(tenantDetails.email, email))
        .returning({ id: tenantDetails.id })
      anonymised.tenant_details = t.length

      const e = await tx
        .update(emailLogs)
        .set({ recipientEmail: REDACTED })
        .where(eq(emailLogs.recipientEmail, email))
        .returning({ id: emailLogs.id })
      anonymised.email_logs = e.length

      const w = await tx
        .update(waitlistLeads)
        .set({ fullName: REDACTED, email: REDACTED, phone: null })
        .where(eq(waitlistLeads.email, email))
        .returning({ id: waitlistLeads.id })
      anonymised.waitlist_leads = w.length
    }
  })

  // Optionally include inspection photos (by job prefix) for hard deletion.
  if (opts.deletePhotos && jobIds.length) {
    for (const jobId of jobIds) {
      try {
        const { data: list } = await admin.storage.from('job-photos').list(jobId)
        for (const obj of list ?? []) {
          toDelete.push({ bucket: 'job-photos', path: `${jobId}/${obj.name}` })
        }
      } catch (err) {
        errors.push(`list job-photos/${jobId} failed: ${err instanceof Error ? err.message : 'error'}`)
      }
    }
  } else if (jobIds.length) {
    retained.push(`inspection photos for ${jobIds.length} job(s) (set deletePhotos to remove)`)
  }

  // ── Delete the sensitive storage objects ─────────────────────────────────
  const byBucket = new Map<string, string[]>()
  for (const o of toDelete) {
    byBucket.set(o.bucket, [...(byBucket.get(o.bucket) ?? []), o.path])
  }
  for (const [bucket, paths] of byBucket) {
    try {
      const { error } = await admin.storage.from(bucket).remove(paths)
      if (error) errors.push(`remove ${bucket}: ${error.message}`)
      else storageDeleted.push(...paths.map((p) => `${bucket}/${p}`))
    } catch (err) {
      errors.push(`remove ${bucket} failed: ${err instanceof Error ? err.message : 'error'}`)
    }
  }

  // ── Anonymise the Auth email ─────────────────────────────────────────────
  if (userId && opts.anonymiseAuth !== false) {
    try {
      await admin.auth.admin.updateUserById(userId, {
        email: `erased+${userId}@deleted.invalid`,
        user_metadata: {},
        ban_duration: '876000h', // effectively permanent
      })
    } catch (err) {
      errors.push(`auth anonymise failed: ${err instanceof Error ? err.message : 'error'}`)
    }
  }

  // ── Audit ────────────────────────────────────────────────────────────────
  await withServiceRole((tx) =>
    logAuditEvent(tx, {
      // Reuse the existing `account_status` enum category (the account is being
      // erased); the `gdpr.erasure` action keeps the intent unambiguous.
      category: 'account_status',
      action: 'gdpr.erasure',
      actorUserId,
      targetType: 'data_subject',
      targetId: userId ?? email ?? 'unknown',
      payload: {
        subjectUserId: userId,
        subjectEmail: email ? `${email.slice(0, 2)}***` : null,
        anonymised,
        storageDeletedCount: storageDeleted.length,
        deletePhotos: Boolean(opts.deletePhotos),
        errors,
      },
    })
  ).catch((err) => errors.push(`audit failed: ${err instanceof Error ? err.message : 'error'}`))

  return {
    subject: { userId, email },
    anonymised,
    storageDeleted,
    retained,
    errors,
  }
}
