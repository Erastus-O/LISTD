import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { errorResponse, escapeHtml, notFound, ok } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import { FROM_NOTIFICATIONS, getResend, logEmail } from '@/lib/resend'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { jobs, profiles, properties, withServiceRole } from '@/db'
import { shouldNotify } from '@/lib/notify-prefs'

export const maxDuration = 15
export const runtime = 'nodejs'

const RequestSchema = z.object({
  jobId: z.string().uuid(),
  reportUrl: z.string().url().optional().or(z.literal('')),
})

const INSPECTION_LABELS: Record<string, string> = {
  new_inventory: 'New Inventory',
  check_in: 'Check-In',
  check_out: 'Check-Out',
  mid_term: 'Mid-Term',
  interim: 'Interim',
}

/**
 * POST /api/notifications/report-submitted — notify the client a clerk has
 * submitted their inspection report and it's awaiting client review.
 * Replaces supabase/functions/notify-report-submitted/index.ts.
 */
export async function POST(req: Request) {
  const session = await authorizeRequest()
  if (session instanceof Response) return session

  try {
    const body = await req.json()
    const { jobId, reportUrl } = RequestSchema.parse(body)

    const { job, clientName, clerkName, optedOut } = await withServiceRole(
      async (tx) => {
        const [j] = await tx
          .select({
            clientId: jobs.clientId,
            clerkId: jobs.clerkId,
            inspectionType: jobs.inspectionType,
            scheduledDate: jobs.scheduledDate,
            addressLine1: properties.addressLine1,
            city: properties.city,
            postcode: properties.postcode,
          })
          .from(jobs)
          .leftJoin(properties, eq(jobs.propertyId, properties.id))
          .where(eq(jobs.id, jobId))
          .limit(1)

        if (!j)
          return { job: null, clientName: '', clerkName: '', optedOut: false }

        const [clientProfile] = await tx
          .select({ fullName: profiles.fullName })
          .from(profiles)
          .where(eq(profiles.userId, j.clientId))
          .limit(1)

        let clerkFullName = ''
        if (j.clerkId) {
          const [clerkProfile] = await tx
            .select({ fullName: profiles.fullName })
            .from(profiles)
            .where(eq(profiles.userId, j.clerkId))
            .limit(1)
          clerkFullName = clerkProfile?.fullName ?? ''
        }

        // Honour the client's email_report_delivery toggle (M1 #16/17).
        const allowed = await shouldNotify(tx, j.clientId, 'emailReportDelivery')

        return {
          job: j,
          clientName: clientProfile?.fullName ?? '',
          clerkName: clerkFullName,
          optedOut: !allowed,
        }
      }
    )

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
    const safeClerkName = escapeHtml(clerkName || 'your inspector')
    const subject = `Your inspection report is ready to review – ${job.addressLine1 ?? 'your property'}`
    const reviewUrl = `${process.env.NEXT_PUBLIC_SITE_URL ?? 'https://listd.co.uk'}/client/reports/${jobId}`

    const html = `
      <!DOCTYPE html>
      <html><head><meta charset="utf-8"></head>
      <body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;margin:0;padding:0;background:#f4f4f5;">
        <div style="max-width:600px;margin:0 auto;padding:20px;">
          <div style="background:#fff;border-radius:12px;padding:32px;box-shadow:0 1px 3px rgba(0,0,0,.1);">
            <div style="text-align:center;margin-bottom:28px;">
              <div style="display:inline-flex;align-items:center;justify-content:center;width:56px;height:56px;background:#f0fdf4;border-radius:50%;margin-bottom:16px;"><span style="font-size:28px;">📋</span></div>
              <h1 style="color:#18181b;font-size:22px;margin:0 0 8px;">Your Inspection Report is Ready</h1>
              <p style="color:#71717a;font-size:15px;margin:0;">Hi ${safeClientName}, your report has been submitted and is awaiting your review.</p>
            </div>
            <div style="background:#f4f4f5;border-radius:8px;padding:20px;margin-bottom:24px;">
              <h2 style="color:#18181b;font-size:15px;font-weight:600;margin:0 0 14px;">Report Summary</h2>
              <table style="width:100%;border-collapse:collapse;">
                <tr><td style="padding:6px 0;color:#71717a;font-size:14px;width:40%;">Type:</td><td style="padding:6px 0;color:#18181b;font-size:14px;font-weight:600;">${safeInspection}</td></tr>
                <tr><td style="padding:6px 0;color:#71717a;font-size:14px;">Property:</td><td style="padding:6px 0;color:#18181b;font-size:14px;">${safeAddress}</td></tr>
                <tr><td style="padding:6px 0;color:#71717a;font-size:14px;">Location:</td><td style="padding:6px 0;color:#18181b;font-size:14px;">${safeCity}, ${safePostcode}</td></tr>
                <tr><td style="padding:6px 0;color:#71717a;font-size:14px;">Date:</td><td style="padding:6px 0;color:#18181b;font-size:14px;">${safeDate}</td></tr>
                <tr><td style="padding:6px 0;color:#71717a;font-size:14px;">Inspector:</td><td style="padding:6px 0;color:#18181b;font-size:14px;">${safeClerkName}</td></tr>
              </table>
            </div>
            <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:16px;margin-bottom:24px;">
              <p style="color:#92400e;font-size:14px;margin:0;"><strong>Action required:</strong> Please review and accept this report within 7 days to release payment to the inspector.</p>
            </div>
            <div style="text-align:center;margin-bottom:24px;">
              <a href="${escapeHtml(reviewUrl)}" style="display:inline-block;background:#0d9488;color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:600;font-size:15px;">Review &amp; Accept Report</a>
            </div>
            ${reportUrl ? `<div style="text-align:center;margin-bottom:24px;"><a href="${escapeHtml(reportUrl)}" style="display:inline-block;color:#0d9488;text-decoration:underline;font-size:13px;">View Full InventoryBase Report</a></div>` : ''}
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
      functionName: 'notify-report-submitted',
      recipientEmails: [clientEmail],
      subject,
      resendId: data?.id ?? null,
      errorMessage: error ? error.message : null,
      metadata: { jobId, inspectionType: job.inspectionType, propertyAddress: job.addressLine1, city: job.city },
    })

    return ok({ success: !error, id: data?.id ?? null })
  } catch (err) {
    return errorResponse(err)
  }
}
