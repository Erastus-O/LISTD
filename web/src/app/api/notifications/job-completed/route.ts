import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { errorResponse, escapeHtml, notFound, ok } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import { FROM_NOTIFICATIONS, getResend, logEmail } from '@/lib/resend'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import {
  jobs,
  platformSettings,
  profiles,
  properties,
  withServiceRole,
} from '@/db'
import { shouldNotify } from '@/lib/notify-prefs'

export const maxDuration = 15
export const runtime = 'nodejs'

const RequestSchema = z.object({ jobId: z.string().uuid() })

const INSPECTION_LABELS: Record<string, string> = {
  new_inventory: 'New Inventory',
  check_in: 'Check-In',
  check_out: 'Check-Out',
  mid_term: 'Mid-Term',
  interim: 'Interim',
}

/**
 * POST /api/notifications/job-completed — notify the client their inspection
 * is complete and the report is available.
 * Replaces supabase/functions/notify-job-completed/index.ts.
 */
export async function POST(req: Request) {
  const session = await authorizeRequest()
  if (session instanceof Response) return session

  try {
    const body = await req.json()
    const { jobId } = RequestSchema.parse(body)

    const { job, clientName, trustpilotLink, googleLink, optedOut } =
      await withServiceRole(async (tx) => {
        const [j] = await tx
          .select({
            clientId: jobs.clientId,
            inspectionType: jobs.inspectionType,
            scheduledDate: jobs.scheduledDate,
            reportUrl: jobs.reportUrl,
            addressLine1: properties.addressLine1,
            city: properties.city,
            postcode: properties.postcode,
          })
          .from(jobs)
          .leftJoin(properties, eq(jobs.propertyId, properties.id))
          .where(eq(jobs.id, jobId))
          .limit(1)

        if (!j)
          return {
            job: null,
            clientName: '',
            trustpilotLink: '',
            googleLink: '',
            optedOut: false,
          }

        const [profile] = await tx
          .select({ fullName: profiles.fullName })
          .from(profiles)
          .where(eq(profiles.userId, j.clientId))
          .limit(1)

        const settings = await tx
          .select({ key: platformSettings.key, value: platformSettings.value })
          .from(platformSettings)
        const settingsMap = new Map(settings.map((s) => [s.key, s.value]))

        // Honour the client's email_report_delivery toggle (M1 #16/17).
        const allowed = await shouldNotify(tx, j.clientId, 'emailReportDelivery')

        return {
          job: j,
          clientName: profile?.fullName ?? '',
          trustpilotLink: settingsMap.get('trustpilot_review_link') ?? '',
          googleLink: settingsMap.get('google_review_link') ?? '',
          optedOut: !allowed,
        }
      })

    if (!job) return notFound('Job not found')
    if (optedOut) return ok({ success: true, skipped: 'pref_off' })

    const admin = getSupabaseAdmin()
    const {
      data: { user: clientUser },
      error: userError,
    } = await admin.auth.admin.getUserById(job.clientId)
    if (userError || !clientUser?.email) return notFound('Client email not found')
    const clientEmail = clientUser.email

    const inspectionLabel =
      INSPECTION_LABELS[job.inspectionType] ?? job.inspectionType
    const formattedDate = job.scheduledDate
      ? new Date(job.scheduledDate).toLocaleDateString('en-GB', {
          weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
        })
      : '—'

    const safeClientName = escapeHtml(clientName || 'there')
    const safeAddress = escapeHtml(job.addressLine1 ?? '')
    const safeCity = escapeHtml(job.city ?? '')
    const safePostcode = escapeHtml(job.postcode ?? '')
    const safeInspection = escapeHtml(inspectionLabel)
    const safeDate = escapeHtml(formattedDate)
    const subject = `Your inspection is complete – ${job.addressLine1 ?? 'your property'}`
    const dashboardUrl = `${process.env.NEXT_PUBLIC_SITE_URL ?? 'https://listd.co.uk'}/client/jobs/${jobId}`

    const reviewSection = [
      trustpilotLink &&
        `<div style="text-align:center;margin-bottom:16px;"><a href="${escapeHtml(trustpilotLink)}" target="_blank" style="display:inline-block;background:#00b67a;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;font-size:14px;">Leave a Trustpilot Review ⭐</a></div>`,
      googleLink &&
        `<div style="text-align:center;margin-bottom:16px;"><a href="${escapeHtml(googleLink)}" target="_blank" style="display:inline-block;color:#0d9488;text-decoration:underline;font-size:13px;">Leave a Google Review</a></div>`,
    ]
      .filter(Boolean)
      .join('')

    const ctaUrl = job.reportUrl ?? dashboardUrl
    const ctaLabel = job.reportUrl ? 'View Your Report' : 'View Job Details'

    const html = `
      <!DOCTYPE html>
      <html><head><meta charset="utf-8"></head>
      <body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;margin:0;padding:0;background:#f4f4f5;">
        <div style="max-width:600px;margin:0 auto;padding:20px;">
          <div style="background:#fff;border-radius:12px;padding:32px;box-shadow:0 1px 3px rgba(0,0,0,.1);">
            <div style="text-align:center;margin-bottom:28px;">
              <div style="display:inline-flex;align-items:center;justify-content:center;width:56px;height:56px;background:#f0fdf4;border-radius:50%;margin-bottom:16px;"><span style="font-size:28px;">✅</span></div>
              <h1 style="color:#18181b;font-size:22px;margin:0 0 8px;">Your Inspection is Complete</h1>
              <p style="color:#71717a;font-size:15px;margin:0;">Hi ${safeClientName}, your inspection has been completed successfully.</p>
            </div>
            <div style="background:#f4f4f5;border-radius:8px;padding:20px;margin-bottom:24px;">
              <h2 style="color:#18181b;font-size:15px;font-weight:600;margin:0 0 14px;">Job Summary</h2>
              <table style="width:100%;border-collapse:collapse;">
                <tr><td style="padding:6px 0;color:#71717a;font-size:14px;width:40%;">Type:</td><td style="padding:6px 0;color:#18181b;font-size:14px;font-weight:600;">${safeInspection}</td></tr>
                <tr><td style="padding:6px 0;color:#71717a;font-size:14px;">Property:</td><td style="padding:6px 0;color:#18181b;font-size:14px;">${safeAddress}</td></tr>
                <tr><td style="padding:6px 0;color:#71717a;font-size:14px;">Location:</td><td style="padding:6px 0;color:#18181b;font-size:14px;">${safeCity}, ${safePostcode}</td></tr>
                <tr><td style="padding:6px 0;color:#71717a;font-size:14px;">Date:</td><td style="padding:6px 0;color:#18181b;font-size:14px;">${safeDate}</td></tr>
              </table>
            </div>
            <div style="text-align:center;margin-bottom:24px;">
              <a href="${escapeHtml(ctaUrl)}" style="display:inline-block;background:#0d9488;color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:600;font-size:15px;">${ctaLabel}</a>
            </div>
            ${reviewSection ? `<div style="border-top:1px solid #f4f4f5;padding-top:20px;margin-bottom:8px;"><p style="color:#71717a;font-size:14px;text-align:center;margin:0 0 16px;">Happy with the service? We'd love to hear from you!</p>${reviewSection}</div>` : ''}
            <p style="color:#a1a1aa;font-size:12px;text-align:center;margin-top:24px;border-top:1px solid #f4f4f5;padding-top:16px;">Questions? <a href="mailto:hello@listd.co.uk" style="color:#0d9488;">hello@listd.co.uk</a></p>
          </div>
          <div style="text-align:center;margin-top:20px;"><p style="color:#a1a1aa;font-size:12px;">&copy; ${new Date().getFullYear()} LISTD. All rights reserved.</p></div>
        </div>
      </body></html>
    `.trim()

    const { data, error } = await getResend().emails.send({
      from: FROM_NOTIFICATIONS,
      to: [clientEmail],
      subject,
      html,
    })

    await logEmail({
      functionName: 'notify-job-completed',
      recipientEmails: [clientEmail],
      subject,
      resendId: data?.id ?? null,
      errorMessage: error ? error.message : null,
      metadata: {
        jobId,
        inspectionType: job.inspectionType,
        propertyAddress: job.addressLine1,
        city: job.city,
      },
    })

    return ok({ success: !error, id: data?.id ?? null })
  } catch (err) {
    return errorResponse(err)
  }
}
