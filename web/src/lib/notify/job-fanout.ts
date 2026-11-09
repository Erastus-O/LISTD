import 'server-only'
import { eq, inArray } from 'drizzle-orm'
import {
  jobs,
  notifications,
  profiles,
  properties,
  userRoles,
  withServiceRole,
} from '@/db'
import { escapeHtml } from '@/lib/api'
import { buildCoverageMatcher } from '@/lib/coverage-radius'
import { loadUserNotificationPrefs } from '@/lib/notify-prefs'
import { sendPushToUser } from '@/lib/push'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { FROM_NOTIFICATIONS, getResend, logEmail } from '@/lib/resend'
import {
  INSPECTION_TYPE_LABELS,
  cleaningLabelFromType,
  isCleaningType,
} from '@/lib/pricing-matrix'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://listd.co.uk'

/**
 * Notify the right providers when a job goes **published** — the moment a
 * client's post becomes live (escrow payment captured, or auto-publish when
 * escrow is off).
 *
 * Audience:
 *   - Cleaning jobs (`inspection_type` = clean_*) → users with the `cleaner`
 *     role, matched on `profiles.coverage_areas` (postcode district).
 *   - Repairs → users with the `trades` role.
 *   - Everything else → users with the `clerk` (Pro) role, matched on
 *     coverage AND `service_types_offered` (mirrors the Available Jobs feed:
 *     an empty whitelist means "open to all types").
 *
 * Only providers who have **set a coverage area** are notified — someone who
 * hasn't told us where they work isn't "in that postcode", and proactively
 * pinging them on every post would be spam. (They still see everything in
 * their Available Jobs feed.)
 *
 * Channels (each gated by the recipient's notification preferences):
 *   - in-app bell row (`inappJobUpdates`)
 *   - web push (`inappJobUpdates`; no-ops if they have no push subscription)
 *   - email (`emailJobUpdates`)
 *
 * Best-effort and self-contained: it never throws, so a notification problem
 * can't fail the publish/payment path. Call it AFTER the publish commits.
 */
export async function notifyMatchingProvidersOnPublish(
  jobId: string
): Promise<{ matched: number; inApp: number; pushed: number; emailed: number }> {
  const empty = { matched: 0, inApp: 0, pushed: 0, emailed: 0 }
  try {
    // 1. Load the published job + its property location.
    const [job] = await withServiceRole((tx) =>
      tx
        .select({
          id: jobs.id,
          inspectionType: jobs.inspectionType,
          scheduledDate: jobs.scheduledDate,
          preferredTimeSlot: jobs.preferredTimeSlot,
          serviceTier: jobs.serviceTier,
          postcode: properties.postcode,
          city: properties.city,
          addressLine1: properties.addressLine1,
        })
        .from(jobs)
        .innerJoin(properties, eq(properties.id, jobs.propertyId))
        .where(eq(jobs.id, jobId))
        .limit(1)
    )
    if (!job || !job.postcode) return empty

    // Prefix check so admin-defined cleaning offerings route to cleaners too.
    const isCleaning = isCleaningType(job.inspectionType)
    const isRepair = job.inspectionType === 'repairs'
    const role = isCleaning ? 'cleaner' : isRepair ? 'trades' : 'clerk'
    const serviceLabel = isRepair
      ? 'Repairs & Maintenance'
      : isCleaning
      ? cleaningLabelFromType(job.inspectionType) ?? 'Clean'
      : INSPECTION_TYPE_LABELS[
          job.inspectionType as keyof typeof INSPECTION_TYPE_LABELS
        ] ?? job.inspectionType
    const dashboardLink = isCleaning
      ? '/cleaner/jobs/available'
      : '/clerk/jobs/available'

    // 2. Candidate providers of the right role + their coverage / services.
    const candidates = await withServiceRole(async (tx) => {
      const roleRows = await tx
        .select({ userId: userRoles.userId })
        .from(userRoles)
        .where(eq(userRoles.role, role))
      const ids = roleRows
        .map((r) => r.userId)
        .filter((id): id is string => Boolean(id))
      if (ids.length === 0) return []
      return tx
        .select({
          userId: profiles.userId,
          coverageAreas: profiles.coverageAreas,
          serviceTypes: profiles.serviceTypesOffered,
        })
        .from(profiles)
        .where(inArray(profiles.userId, ids))
    })

    // 3. Match on coverage (+ service type for Pros). One matcher across all
    //    candidates: full-postcode entries cover a 25 km radius, district
    //    entries keep exact-district semantics.
    const coverageMatcher = await buildCoverageMatcher(
      [job.postcode],
      candidates.map((p) => (p.coverageAreas ?? []).filter(Boolean))
    )
    const matchedIds = candidates
      .filter((p) => {
        const coverage = (p.coverageAreas ?? []).filter(Boolean)
        if (coverage.length === 0) return false // no declared area → skip
        if (!coverageMatcher(job.postcode, coverage)) return false
        if (!isCleaning) {
          const types = (p.serviceTypes ?? []).filter(Boolean)
          // Empty whitelist = open to every inspection type (feed parity).
          if (types.length > 0 && !types.includes(job.inspectionType)) {
            return false
          }
        }
        return true
      })
      .map((p) => p.userId)
      .filter((id): id is string => Boolean(id))

    if (matchedIds.length === 0) return empty

    // 4. Per-recipient preferences (cached blob — cheap to read N times).
    const prefsById = new Map(
      await Promise.all(
        matchedIds.map(
          async (id) => [id, await loadUserNotificationPrefs(id)] as const
        )
      )
    )

    const district = job.postcode.trim().toUpperCase().split(/\s+/)[0]
    const formattedDate = new Date(job.scheduledDate).toLocaleDateString(
      'en-GB',
      { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }
    )
    const title = 'New job in your area'
    const message = `${serviceLabel} in ${job.city ?? district} (${district}) on ${formattedDate}.`

    // 5a. In-app bell rows — one batched insert for the opted-in subset.
    const inAppIds = matchedIds.filter(
      (id) => prefsById.get(id)?.inappJobUpdates !== false
    )
    if (inAppIds.length > 0) {
      await withServiceRole((tx) =>
        tx.insert(notifications).values(
          inAppIds.map((userId) => ({
            userId,
            type: 'job',
            title,
            message,
            link: dashboardLink,
          }))
        )
      )
    }

    // 5b. Web push — same opt-in gate; sendPushToUser no-ops without a sub.
    await Promise.allSettled(
      inAppIds.map((id) =>
        sendPushToUser(id, {
          title,
          body: message,
          url: dashboardLink,
          tag: `job-${job.id}`,
        })
      )
    )

    // 5c. Email — opted-in subset, resolve addresses via the auth admin API
    //     (auth.users isn't reachable through Drizzle).
    const emailIds = new Set(
      matchedIds.filter((id) => prefsById.get(id)?.emailJobUpdates !== false)
    )
    let emailed = 0
    if (emailIds.size > 0) {
      const admin = getSupabaseAdmin()
      const {
        data: { users },
      } = await admin.auth.admin.listUsers({ perPage: 1000 })
      const recipientEmails = users
        .filter((u) => emailIds.has(u.id) && !!u.email)
        .map((u) => u.email!)

      if (recipientEmails.length > 0) {
        const subject = `New job available: ${serviceLabel} in ${job.city ?? district}`
        const html = buildEmailHtml({
          serviceLabel,
          city: job.city ?? district,
          district,
          formattedDate,
          dashboardLink,
        })
        // Individual sends (Promise.allSettled) so one recipient's address is
        // never exposed to the others, and one failure can't sink the batch.
        const results = await Promise.allSettled(
          recipientEmails.map((to) =>
            getResend().emails.send({
              from: FROM_NOTIFICATIONS,
              to: [to],
              subject,
              html,
            })
          )
        )
        emailed = results.filter(
          (r) => r.status === 'fulfilled' && !r.value.error
        ).length
        await logEmail({
          functionName: 'notify-job-published',
          recipientEmails,
          subject,
          resendId: null,
          errorMessage: emailed === recipientEmails.length ? null : 'partial',
          metadata: {
            jobId: job.id,
            role,
            district,
            matched: matchedIds.length,
            emailed,
          },
        })
      }
    }

    return {
      matched: matchedIds.length,
      inApp: inAppIds.length,
      pushed: inAppIds.length,
      emailed,
    }
  } catch (err) {
    console.warn('[notify/job-fanout] failed for job', jobId, err)
    return empty
  }
}

function buildEmailHtml(p: {
  serviceLabel: string
  city: string
  district: string
  formattedDate: string
  dashboardLink: string
}): string {
  return `
    <!DOCTYPE html>
    <html><head><meta charset="utf-8"></head>
    <body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;margin:0;padding:0;background:#f4f4f5;">
      <div style="max-width:600px;margin:0 auto;padding:20px;">
        <div style="background:#fff;border-radius:12px;padding:32px;box-shadow:0 1px 3px rgba(0,0,0,.1);">
          <h1 style="color:#18181b;font-size:22px;margin:0 0 16px;">New job in your area</h1>
          <p style="color:#52525b;font-size:16px;line-height:1.5;margin:0 0 24px;">A new <strong>${escapeHtml(p.serviceLabel)}</strong> job has been published in <strong>${escapeHtml(p.city)} (${escapeHtml(p.district)})</strong> for <strong>${escapeHtml(p.formattedDate)}</strong> and matches your coverage area.</p>
          <div style="text-align:center;">
            <a href="${escapeHtml(SITE_URL + p.dashboardLink)}" style="display:inline-block;background:#0d9488;color:#fff;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:600;font-size:16px;">View &amp; accept</a>
          </div>
          <p style="color:#a1a1aa;font-size:12px;text-align:center;margin-top:32px;">First-come, first-served. Manage these emails in your notification settings.</p>
        </div>
        <div style="text-align:center;margin-top:20px;"><p style="color:#a1a1aa;font-size:12px;">&copy; ${new Date().getFullYear()} LISTD.</p></div>
      </div>
    </body></html>
  `.trim()
}
