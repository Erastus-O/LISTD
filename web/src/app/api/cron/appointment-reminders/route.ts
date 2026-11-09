import { and, eq, inArray } from 'drizzle-orm'
import { errorResponse, ok, unauthorized } from '@/lib/api'
import {
  appointmentRemindersSent,
  jobs,
  notifications,
  organisationMembers,
  profiles,
  properties,
  withServiceRole,
} from '@/db'
import { shouldNotify, type NotificationPrefKey } from '@/lib/notify-prefs'
import { verifyCronAuth, verifyExternalApiKey } from '@/lib/webhooks'
import { FROM_NOTIFICATIONS, getResend, logEmail } from '@/lib/resend'
import { sendSms } from '@/lib/sms'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { escapeHtml } from '@/lib/api'
import {
  buildGoogleCalendarUrl,
  buildIcsContent,
  resolveJobSchedule,
  type CalendarEvent,
} from '@/lib/calendar'

export const maxDuration = 60
export const runtime = 'nodejs'

/**
 * GET /api/cron/appointment-reminders
 *
 * Vercel Cron — daily at 17:00 UTC. Sends "your inspection is tomorrow"
 * reminders to the client, any org owners on the booking, and the
 * assigned clerk for every active job whose `scheduled_date` is the next
 * UTC day.
 *
 * Closes the long-standing **consent ghost** in `notification_preferences`:
 * `emailMidtermReminder` and `emailCheckoutReminder` have been
 * user-toggleable since M-Pre but nothing has been sending them. This
 * handler is what those toggles gate. For inspection types that don't
 * have a dedicated toggle (new_inventory, check_in, interim), the
 * general `emailJobUpdates` preference applies — same toggle that gates
 * every other job-event email.
 *
 * In-app notifications are always written (the bell badge isn't covered
 * by the preference scheme); only the email send is gated.
 *
 * **Idempotency.** The (job_id, 'day_before') unique constraint on
 * [`appointment_reminders_sent`](../../../../../db/migrations/0020_appointment_reminders.sql)
 * absorbs retries — Vercel's automatic cron retry-on-failure won't
 * double-send. The pre-check below also short-circuits before we touch
 * Resend so a retry that landed after a successful run costs ~one
 * SELECT, not N email sends.
 *
 * **Volume sanity.** Expected daily job count is dozens, not thousands,
 * for the foreseeable LISTD scale. We pull all auth.users in one
 * `listUsers({ perPage: 1000 })` call to skip N+1 email lookups; if the
 * platform crosses 1k active users we'll need to switch to per-batch
 * pagination.
 */

const REMINDER_KIND = 'day_before' as const

// Inspection types that have a dedicated email-preference toggle. For
// everything else, fall back to `emailJobUpdates` (the umbrella job-event
// toggle that the rest of the codebase already uses).
const PREF_BY_INSPECTION_TYPE: Record<string, NotificationPrefKey> = {
  mid_term: 'emailMidtermReminder',
  check_out: 'emailCheckoutReminder',
}

const INSPECTION_LABELS: Record<string, string> = {
  new_inventory: 'New Inventory',
  check_in: 'Check-In',
  check_out: 'Check-Out',
  mid_term: 'Mid-Term',
  interim: 'Interim',
}

/** Job statuses that should still receive a reminder. Submitted /
 *  completed / cancelled jobs are excluded — the inspection is past or
 *  cancelled and a reminder would be confusing. */
const ACTIVE_STATUSES = ['accepted', 'assigned', 'in_progress'] as const

export async function GET(req: Request) {
  if (!verifyCronAuth(req) && !verifyExternalApiKey(req)) {
    return unauthorized()
  }

  try {
    const tomorrowDateOnly = formatYmd(addDays(new Date(), 1))

    const result = await withServiceRole(async (tx) => {
      // ── 1. Pull candidate jobs (scheduled for tomorrow, active) ────
      const candidates = await tx
        .select({
          id: jobs.id,
          clientId: jobs.clientId,
          clerkId: jobs.clerkId,
          organisationId: jobs.organisationId,
          propertyId: jobs.propertyId,
          inspectionType: jobs.inspectionType,
          scheduledDate: jobs.scheduledDate,
          scheduledAt: jobs.scheduledAt,
          preferredTimeSlot: jobs.preferredTimeSlot,
          accessMethod: jobs.accessMethod,
        })
        .from(jobs)
        .where(
          and(
            eq(jobs.scheduledDate, tomorrowDateOnly),
            inArray(jobs.status, [...ACTIVE_STATUSES])
          )
        )

      if (candidates.length === 0) {
        return { jobsReminded: 0, recipients: 0, emailsSent: 0, emailsSkipped: 0 }
      }

      // ── 2. Drop jobs we've already reminded for this kind ───────────
      const candidateIds = candidates.map((c) => c.id)
      const alreadySent = await tx
        .select({ jobId: appointmentRemindersSent.jobId })
        .from(appointmentRemindersSent)
        .where(
          and(
            eq(appointmentRemindersSent.kind, REMINDER_KIND),
            inArray(appointmentRemindersSent.jobId, candidateIds)
          )
        )
      const alreadySentSet = new Set(alreadySent.map((r) => r.jobId))
      const surviving = candidates.filter((c) => !alreadySentSet.has(c.id))
      if (surviving.length === 0) {
        return { jobsReminded: 0, recipients: 0, emailsSent: 0, emailsSkipped: 0 }
      }

      // ── 3. Resolve property addresses in one query ───────────────────
      const propertyIds = Array.from(
        new Set(surviving.map((c) => c.propertyId).filter((p): p is string => Boolean(p)))
      )
      const propertyRows = propertyIds.length
        ? await tx
            .select({
              id: properties.id,
              addressLine1: properties.addressLine1,
              city: properties.city,
              postcode: properties.postcode,
            })
            .from(properties)
            .where(inArray(properties.id, propertyIds))
        : []
      const propertyById = new Map(propertyRows.map((p) => [p.id, p]))

      // ── 4. Resolve org owners for org jobs in one query ──────────────
      const orgIds = Array.from(
        new Set(
          surviving
            .map((c) => c.organisationId)
            .filter((o): o is string => Boolean(o))
        )
      )
      const orgOwnerRows = orgIds.length
        ? await tx
            .select({
              organisationId: organisationMembers.organisationId,
              userId: organisationMembers.userId,
            })
            .from(organisationMembers)
            .where(
              and(
                inArray(organisationMembers.organisationId, orgIds),
                eq(organisationMembers.orgRole, 'owner'),
                eq(organisationMembers.status, 'active')
              )
            )
        : []
      const ownersByOrg = new Map<string, string[]>()
      for (const o of orgOwnerRows) {
        const list = ownersByOrg.get(o.organisationId) ?? []
        list.push(o.userId)
        ownersByOrg.set(o.organisationId, list)
      }

      // ── 5. Resolve recipient emails ──────────────────────────────────
      // One bulk listUsers call beats N+1 getUserById. perPage=1000 covers
      // every active LISTD user comfortably; bump if this ever truncates.
      const admin = getSupabaseAdmin()
      const { data: usersData, error: usersError } =
        await admin.auth.admin.listUsers({ perPage: 1000 })
      if (usersError) throw usersError
      const emailByUserId = new Map<string, string>()
      for (const u of usersData.users) {
        if (u.email) emailByUserId.set(u.id, u.email)
      }

      // ── 5b. Resolve recipient phones (for SMS fan-out) ───────────────
      // Collect every userId we might text in one bulk select against
      // profiles — beats per-recipient lookups inside the dispatch loop.
      const allRecipientIds = new Set<string>()
      for (const job of surviving) {
        allRecipientIds.add(job.clientId)
        if (job.clerkId) allRecipientIds.add(job.clerkId)
        if (job.organisationId) {
          const owners = ownersByOrg.get(job.organisationId) ?? []
          for (const ownerId of owners) allRecipientIds.add(ownerId)
        }
      }
      const phoneRows =
        allRecipientIds.size > 0
          ? await tx
              .select({ userId: profiles.userId, phone: profiles.phone })
              .from(profiles)
              .where(inArray(profiles.userId, Array.from(allRecipientIds)))
          : []
      const phoneByUserId = new Map<string, string>()
      for (const p of phoneRows) {
        if (p.phone) phoneByUserId.set(p.userId, p.phone)
      }

      // ── 6. For each job, build the recipient set + fire ──────────────
      let totalRecipients = 0
      let emailsSent = 0
      let emailsSkipped = 0
      let smsSent = 0
      let smsSkipped = 0
      const remindersToRecord: Array<{
        jobId: string
        kind: string
        recipientCount: number
        emailSentCount: number
        emailSkippedCount: number
      }> = []
      const notificationValues: Array<{
        userId: string
        type: string
        title: string
        message: string
        link: string
      }> = []

      for (const job of surviving) {
        const prop = job.propertyId ? propertyById.get(job.propertyId) : null
        const address = prop
          ? [prop.addressLine1, prop.city, prop.postcode]
              .filter(Boolean)
              .join(', ')
          : 'your property'
        const inspectionLabel =
          INSPECTION_LABELS[job.inspectionType] ?? job.inspectionType
        const timeSuffix = job.preferredTimeSlot
          ? ` (${job.preferredTimeSlot})`
          : ''
        const title = `Reminder: ${inspectionLabel} tomorrow`
        const inAppMessage = `${inspectionLabel} at ${address} is scheduled for tomorrow${timeSuffix}.`

        // Build the recipient set, deduped. Each recipient gets a link
        // routed to the surface that's most useful to them.
        const recipients = new Map<string, { link: string; isClerk: boolean }>()
        recipients.set(job.clientId, {
          link: `/client/jobs/${job.id}`,
          isClerk: false,
        })
        const ownerIds = job.organisationId
          ? ownersByOrg.get(job.organisationId) ?? []
          : []
        for (const ownerId of ownerIds) {
          if (recipients.has(ownerId)) continue
          recipients.set(ownerId, { link: `/client/jobs/${job.id}`, isClerk: false })
        }
        if (job.clerkId) {
          recipients.set(job.clerkId, {
            link: `/clerk/jobs/${job.id}`,
            isClerk: true,
          })
        }

        let jobEmailsSent = 0
        let jobEmailsSkipped = 0

        for (const [userId, meta] of recipients) {
          // Always write the in-app notification — the bell badge isn't
          // covered by any preference toggle today.
          notificationValues.push({
            userId,
            type: 'appointment_reminder',
            title,
            message: inAppMessage,
            link: meta.link,
          })

          // Email gate: clerks use the generic job-updates toggle;
          // clients use the inspection-type-specific toggle when one
          // exists (mid_term / check_out), otherwise the generic one.
          const prefKey: NotificationPrefKey = meta.isClerk
            ? 'emailJobUpdates'
            : PREF_BY_INSPECTION_TYPE[job.inspectionType] ?? 'emailJobUpdates'
          const allowed = await shouldNotify(tx, userId, prefKey)
          if (!allowed) {
            jobEmailsSkipped += 1
            continue
          }

          const email = emailByUserId.get(userId)
          if (!email) {
            jobEmailsSkipped += 1
            continue
          }

          // Build a calendar event payload for this recipient. The
          // role-aware deepLink lands inside the ICS description so the
          // user gets context relevant to their role when they tap the
          // event in their calendar.
          const siteUrl =
            process.env.NEXT_PUBLIC_SITE_URL ?? 'https://listd.co.uk'
          const recipientDeepLink = siteUrl + meta.link
          const calendarSchedule = resolveJobSchedule({
            scheduledAt: job.scheduledAt,
            scheduledDate: job.scheduledDate,
          })
          let icsAttachment:
            | { filename: string; content: Buffer }
            | undefined
          let googleCalUrl: string | null = null
          if (calendarSchedule) {
            const calEvent: CalendarEvent = {
              uid: `job-${job.id}`,
              title: `LISTD Inspection: ${inspectionLabel} at ${
                (job.propertyId ? propertyById.get(job.propertyId) : null)
                  ?.addressLine1 ?? 'your property'
              }`,
              description: [
                `Inspection: ${inspectionLabel}`,
                `Reference: ${job.id.slice(0, 8)}`,
                !calendarSchedule.isExactTime
                  ? '(Time is a placeholder : please confirm the exact slot.)'
                  : null,
                job.preferredTimeSlot
                  ? `Preferred time: ${job.preferredTimeSlot}`
                  : null,
              ]
                .filter(Boolean)
                .join('\n'),
              location: address,
              startsAt: calendarSchedule.startsAt,
              endsAt: calendarSchedule.endsAt,
              url: recipientDeepLink,
            }
            const ics = buildIcsContent(calEvent)
            icsAttachment = {
              filename: `listd-${inspectionLabel.toLowerCase().replace(/\s+/g, '-')}-${job.id.slice(0, 8)}.ics`,
              content: Buffer.from(ics, 'utf-8'),
            }
            googleCalUrl = buildGoogleCalendarUrl(calEvent)
          }

          const subject = `Reminder: ${inspectionLabel} at ${address.split(',')[0] ?? 'your property'} tomorrow`
          const html = renderReminderHtml({
            recipientIsClerk: meta.isClerk,
            inspectionLabel,
            address,
            timeSlot: job.preferredTimeSlot,
            accessMethod: job.accessMethod,
            deepLink: recipientDeepLink,
            googleCalUrl,
          })

          const { data, error } = await getResend().emails.send({
            from: FROM_NOTIFICATIONS,
            to: [email],
            subject,
            html,
            ...(icsAttachment ? { attachments: [icsAttachment] } : {}),
          })

          await logEmail({
            functionName: 'appointment-reminder',
            recipientEmails: [email],
            subject,
            resendId: data?.id ?? null,
            errorMessage: error ? error.message ?? JSON.stringify(error) : null,
            metadata: {
              jobId: job.id,
              inspectionType: job.inspectionType,
              kind: REMINDER_KIND,
              recipientRole: meta.isClerk ? 'clerk' : 'client',
            },
          })

          if (error) {
            // Don't throw — one bad send shouldn't kill the whole cron.
            console.warn(
              `[appointment-reminders] Resend send failed for job=${job.id} recipient=${userId}:`,
              error
            )
            jobEmailsSkipped += 1
          } else {
            jobEmailsSent += 1
          }
        }

        // ── SMS dispatch (parallel to email, independent toggle) ───────
        // Independent of `allowed` above because the user can choose
        // SMS, email, or both. SMS uses the umbrella `smsJobUpdates`
        // toggle for all reminder types — no inspection-type-specific
        // SMS toggles exist, by design (SMS is coarser-grained on
        // purpose; carrier costs justify fewer fine-grained categories).
        const siteUrl =
          process.env.NEXT_PUBLIC_SITE_URL ?? 'https://listd.co.uk'
        const shortAddress = (
          job.propertyId ? propertyById.get(job.propertyId) : null
        )?.addressLine1 ?? 'your property'
        for (const [userId, meta] of recipients) {
          const smsAllowed = await shouldNotify(tx, userId, 'smsJobUpdates')
          if (!smsAllowed) {
            smsSkipped += 1
            continue
          }
          const phone = phoneByUserId.get(userId)
          if (!phone) {
            smsSkipped += 1
            continue
          }
          // Body shape:
          //   client: "LISTD: Reminder — your Mid-Term at 12 Acacia Ave is tomorrow. https://listd.co.uk/client/jobs/abc"
          //   clerk:  "LISTD: Mid-Term at 12 Acacia Ave tomorrow. https://listd.co.uk/clerk/jobs/abc"
          // Both fit comfortably in one SMS segment (160 chars).
          const smsBody = meta.isClerk
            ? `LISTD: ${inspectionLabel} at ${shortAddress} tomorrow${timeSuffix}. ${siteUrl}${meta.link}`
            : `LISTD: Reminder : your ${inspectionLabel} at ${shortAddress} is tomorrow${timeSuffix}. ${siteUrl}${meta.link}`
          const smsResult = await sendSms({
            functionName: 'appointment-reminder',
            recipientUserId: userId,
            toPhone: phone,
            body: smsBody,
            metadata: {
              jobId: job.id,
              inspectionType: job.inspectionType,
              kind: REMINDER_KIND,
              recipientRole: meta.isClerk ? 'clerk' : 'client',
            },
          })
          if (smsResult.ok) smsSent += 1
          else smsSkipped += 1
        }

        totalRecipients += recipients.size
        emailsSent += jobEmailsSent
        emailsSkipped += jobEmailsSkipped
        remindersToRecord.push({
          jobId: job.id,
          kind: REMINDER_KIND,
          recipientCount: recipients.size,
          emailSentCount: jobEmailsSent,
          emailSkippedCount: jobEmailsSkipped,
        })
      }

      // ── 7. Persist in-app notifications + idempotency rows ────────────
      // Both inserts are inside the same tx so a notification row never
      // exists without a matching reminder row guarding against double-
      // sends.
      if (notificationValues.length > 0) {
        await tx.insert(notifications).values(notificationValues)
      }
      if (remindersToRecord.length > 0) {
        // `onConflictDoNothing` on (job_id, kind) — the unique index
        // catches a racing concurrent run. If that ever happens we still
        // want the cron to return ok; double-sending is impossible
        // because the pre-check above filtered already-sent jobs out.
        await tx
          .insert(appointmentRemindersSent)
          .values(remindersToRecord)
          .onConflictDoNothing()
      }

      return {
        jobsReminded: surviving.length,
        recipients: totalRecipients,
        emailsSent,
        emailsSkipped,
        smsSent,
        smsSkipped,
      }
    })

    return ok({ ok: true, kind: REMINDER_KIND, ...result })
  } catch (err) {
    console.error('[appointment-reminders] error:', err)
    return errorResponse(err)
  }
}

// ── helpers ──────────────────────────────────────────────────────────

function addDays(d: Date, n: number): Date {
  const out = new Date(d)
  out.setDate(out.getDate() + n)
  return out
}

function formatYmd(d: Date): string {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function renderReminderHtml(opts: {
  recipientIsClerk: boolean
  inspectionLabel: string
  address: string
  timeSlot: string | null
  accessMethod: string | null
  deepLink: string
  googleCalUrl: string | null
}): string {
  const safeLabel = escapeHtml(opts.inspectionLabel)
  const safeAddress = escapeHtml(opts.address)
  const safeTime = opts.timeSlot ? escapeHtml(opts.timeSlot) : null
  const safeAccess = opts.accessMethod ? escapeHtml(opts.accessMethod) : null
  const safeLink = escapeHtml(opts.deepLink)
  const safeGoogleUrl = opts.googleCalUrl ? escapeHtml(opts.googleCalUrl) : null
  const ctaText = opts.recipientIsClerk ? 'Open the job' : 'View booking'
  const intro = opts.recipientIsClerk
    ? `Quick heads-up : you have a ${safeLabel} inspection scheduled for tomorrow at ${safeAddress}.`
    : `This is a friendly reminder that your ${safeLabel} inspection is scheduled for tomorrow at ${safeAddress}.`

  return `
<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 20px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 6px rgba(0,0,0,.1);">
        <tr><td style="background:linear-gradient(135deg,#0F172A,#1E293B);padding:32px;text-align:center;">
          <h1 style="margin:0;color:#fff;font-size:24px;font-weight:700;letter-spacing:-0.02em;">Inspection tomorrow</h1>
        </td></tr>
        <tr><td style="padding:32px;">
          <p style="margin:0 0 16px;color:#0F172A;font-size:15px;line-height:1.6;">${intro}</p>
          <table width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0 20px;background:#F8FAFC;border-radius:8px;padding:16px;">
            <tr><td style="padding:6px 0;color:#64748B;font-size:13px;width:38%;">Type</td><td style="padding:6px 0;color:#0F172A;font-size:13px;font-weight:600;">${safeLabel}</td></tr>
            <tr><td style="padding:6px 0;color:#64748B;font-size:13px;">Address</td><td style="padding:6px 0;color:#0F172A;font-size:13px;font-weight:600;">${safeAddress}</td></tr>
            ${safeTime ? `<tr><td style="padding:6px 0;color:#64748B;font-size:13px;">Preferred time</td><td style="padding:6px 0;color:#0F172A;font-size:13px;font-weight:600;">${safeTime}</td></tr>` : ''}
            ${safeAccess ? `<tr><td style="padding:6px 0;color:#64748B;font-size:13px;">Access</td><td style="padding:6px 0;color:#0F172A;font-size:13px;font-weight:600;">${safeAccess}</td></tr>` : ''}
          </table>
          <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:8px 0;">
            <a href="${safeLink}" style="display:inline-block;background:#2EC4B6;color:#0F172A;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:600;font-size:15px;">${ctaText}</a>
          </td></tr></table>
          ${
            safeGoogleUrl
              ? `<p style="margin:20px 0 0;color:#475569;font-size:13px;line-height:1.6;text-align:center;">
            We've attached a calendar file (.ics) for Apple / Outlook /
            Fastmail / any other client.<br>
            <a href="${safeGoogleUrl}" style="color:#0F172A;font-weight:600;text-decoration:underline;">Add to Google Calendar instead</a>
          </p>`
              : ''
          }
          <p style="margin:24px 0 0;color:#94A3B8;font-size:12px;line-height:1.5;">
            You're receiving this because email reminders are enabled in your
            notification preferences. Update them in your account settings to
            opt out.
          </p>
        </td></tr>
        <tr><td style="background:#F8FAFC;padding:20px 32px;text-align:center;">
          <p style="margin:0;color:#94A3B8;font-size:12px;">&copy; ${new Date().getFullYear()} LISTD Pro</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>
`.trim()
}
