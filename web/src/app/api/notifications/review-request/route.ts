import { and, eq, isNull, lte } from 'drizzle-orm'
import { errorResponse, escapeHtml, ok } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import { FROM_NOTIFICATIONS, getResend, logEmail } from '@/lib/resend'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import {
  jobs,
  platformSettings,
  properties,
  withServiceRole,
} from '@/db'
import { shouldNotify } from '@/lib/notify-prefs'

export const maxDuration = 60
export const runtime = 'nodejs'

/**
 * POST /api/notifications/review-request — batch-send Google review requests
 * to clients who accepted a report 24h+ ago and haven't been emailed yet.
 *
 * Replaces supabase/functions/send-review-request/index.ts.
 * Tightened from the original: now requires admin auth since this is a
 * batch send across many users.
 */
export async function POST() {
  const session = await authorizeRequest('admin')
  if (session instanceof Response) return session

  try {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

    const { settings, candidates } = await withServiceRole(async (tx) => {
      const settingsRows = await tx
        .select({ key: platformSettings.key, value: platformSettings.value })
        .from(platformSettings)

      const candidateRows = await tx
        .select({
          id: jobs.id,
          clientId: jobs.clientId,
          propertyId: jobs.propertyId,
          addressLine1: properties.addressLine1,
          city: properties.city,
        })
        .from(jobs)
        .leftJoin(properties, eq(jobs.propertyId, properties.id))
        .where(
          and(
            eq(jobs.clientReportAccepted, true),
            isNull(jobs.reviewEmailSentAt),
            lte(jobs.clientReportAcceptedAt, cutoff)
          )
        )

      return { settings: settingsRows, candidates: candidateRows }
    })

    const settingsMap = new Map(settings.map((s) => [s.key, s.value]))
    if (settingsMap.get('review_email_enabled') !== 'true') {
      return ok({ message: 'Review emails disabled', sent: 0 })
    }
    const reviewLink =
      settingsMap.get('google_review_link') ??
      'https://g.page/r/CfNpNpoSIt-1EAI/review'

    if (candidates.length === 0) {
      return ok({ message: 'No pending review emails', sent: 0 })
    }

    // Resolve client emails in one Supabase admin call.
    const admin = getSupabaseAdmin()
    const {
      data: { users },
      error: usersError,
    } = await admin.auth.admin.listUsers({ perPage: 1000 })
    if (usersError) throw usersError
    const emailByUserId = new Map(
      users.filter((u) => u.email).map((u) => [u.id, u.email!])
    )

    let sent = 0
    let skippedOptOut = 0
    for (const job of candidates) {
      const clientEmail = emailByUserId.get(job.clientId)
      if (!clientEmail) continue

      // Honour the email_marketing toggle — review requests are a marketing
      // CTA, not transactional (M1 #16/17).
      const allowed = await withServiceRole((tx) =>
        shouldNotify(tx, job.clientId, 'emailMarketing')
      )
      if (!allowed) {
        skippedOptOut++
        continue
      }

      const address =
        job.addressLine1 && job.city
          ? `${job.addressLine1}, ${job.city}`
          : 'your property'
      const safeAddress = escapeHtml(address)
      const safeReviewLink = escapeHtml(reviewLink)
      const subject = 'Quick favour?'

      const html = `
        <div style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1a1a1a;padding:40px 20px;">
          <h2 style="font-size:22px;font-weight:600;margin:0 0 16px;">Quick favour?</h2>
          <p style="font-size:15px;line-height:1.6;color:#555;margin:0 0 12px;">Thank you for using LISTD for your recent inspection at <strong>${safeAddress}</strong>.</p>
          <p style="font-size:15px;line-height:1.6;color:#555;margin:0 0 24px;">If you were happy with the service, we'd really appreciate a quick Google review. Your feedback helps us grow.</p>
          <a href="${safeReviewLink}" target="_blank" style="display:inline-block;background:#2D6A4F;color:#fff;text-decoration:none;padding:14px 28px;font-size:15px;font-weight:500;">Leave a Google Review ⭐</a>
          <p style="font-size:12px;color:#999;margin-top:40px;border-top:1px solid #eee;padding-top:20px;">LISTD · Professional Inventory Services<br/><a href="https://listd.co.uk" style="color:#999;">listd.co.uk</a></p>
        </div>
      `.trim()

      const { data, error } = await getResend().emails.send({
        from: FROM_NOTIFICATIONS,
        to: [clientEmail],
        subject,
        html,
      })

      if (!error) {
        await withServiceRole(async (tx) =>
          tx
            .update(jobs)
            .set({ reviewEmailSentAt: new Date().toISOString() })
            .where(eq(jobs.id, job.id))
        )
        await logEmail({
          functionName: 'send-review-request',
          recipientEmails: [clientEmail],
          subject,
          resendId: data?.id ?? null,
          metadata: { jobId: job.id },
        })
        sent++
      } else {
        await logEmail({
          functionName: 'send-review-request',
          recipientEmails: [clientEmail],
          subject,
          resendId: null,
          errorMessage: error.message,
          metadata: { jobId: job.id },
        })
      }
    }

    return ok({
      message: `Sent ${sent} review request emails`,
      sent,
      skippedOptOut,
    })
  } catch (err) {
    console.error('[review-request] error:', err)
    return errorResponse(err)
  }
}
