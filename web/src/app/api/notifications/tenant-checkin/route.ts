import { asc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { errorResponse, escapeHtml, notFound, ok } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import { FROM_NOTIFICATIONS, getResend, logEmail } from '@/lib/resend'
import {
  jobs,
  properties,
  tenantDetails,
  withServiceRole,
} from '@/db'

export const maxDuration = 30
export const runtime = 'nodejs'

const RequestSchema = z.object({ jobId: z.string().uuid() })

/**
 * POST /api/notifications/tenant-checkin — email each tenant on a check-in
 * job to confirm their inspection appointment.
 * Replaces supabase/functions/notify-tenant-checkin/index.ts.
 */
export async function POST(req: Request) {
  const session = await authorizeRequest()
  if (session instanceof Response) return session

  try {
    const body = await req.json()
    const { jobId } = RequestSchema.parse(body)

    const { job, tenants } = await withServiceRole(async (tx) => {
      const [j] = await tx
        .select({
          inspectionType: jobs.inspectionType,
          scheduledDate: jobs.scheduledDate,
          addressLine1: properties.addressLine1,
          addressLine2: properties.addressLine2,
          city: properties.city,
          postcode: properties.postcode,
        })
        .from(jobs)
        .leftJoin(properties, eq(jobs.propertyId, properties.id))
        .where(eq(jobs.id, jobId))
        .limit(1)

      if (!j) return { job: null, tenants: [] as Array<{ email: string | null; fullName: string | null; tenantOrder: number | null }> }

      const tenantsRows = await tx
        .select({
          email: tenantDetails.email,
          fullName: tenantDetails.fullName,
          tenantOrder: tenantDetails.tenantOrder,
        })
        .from(tenantDetails)
        .where(eq(tenantDetails.jobId, jobId))
        .orderBy(asc(tenantDetails.tenantOrder))

      return { job: j, tenants: tenantsRows }
    })

    if (!job) return notFound('Job not found')
    if (job.inspectionType !== 'check_in') {
      return ok({ message: 'Not a check-in job, skipping' })
    }
    if (tenants.length === 0) {
      return ok({ message: 'No tenant details found, skipping' })
    }

    const address = job.addressLine1
      ? `${job.addressLine1}${job.addressLine2 ? ', ' + job.addressLine2 : ''}, ${job.city ?? ''}, ${job.postcode ?? ''}`
      : 'Your property'
    const safeAddress = escapeHtml(address)
    const scheduledDate = job.scheduledDate
      ? new Date(job.scheduledDate).toLocaleDateString('en-GB', {
          weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
        })
      : ''
    const safeScheduled = escapeHtml(scheduledDate)
    const propertyNickname = job.addressLine1 ?? 'Your Property'
    const subject = `Check-In Confirmed : ${propertyNickname}`

    const emailsSent: string[] = []

    for (const tenant of tenants) {
      if (!tenant.email) continue

      const greetingName = tenant.fullName ? ' ' + tenant.fullName : ''
      const safeGreeting = escapeHtml(greetingName)

      const html = `
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
          <h1 style="color:#1a1a1a;font-size:22px;margin-bottom:8px;">Check-In Confirmation</h1>
          <p style="color:#666;font-size:14px;margin-bottom:24px;">Hello${safeGreeting}, your check-in inspection has been confirmed.</p>
          <div style="background:#f8f9fa;border-radius:8px;padding:20px;margin-bottom:24px;">
            <table style="width:100%;border-collapse:collapse;">
              <tr><td style="padding:6px 0;color:#888;font-size:13px;width:120px;">Property</td><td style="padding:6px 0;color:#1a1a1a;font-size:13px;font-weight:500;">${safeAddress}</td></tr>
              <tr><td style="padding:6px 0;color:#888;font-size:13px;">Date</td><td style="padding:6px 0;color:#1a1a1a;font-size:13px;font-weight:500;">${safeScheduled}</td></tr>
              <tr><td style="padding:6px 0;color:#888;font-size:13px;">Inspection Type</td><td style="padding:6px 0;color:#1a1a1a;font-size:13px;font-weight:500;">Check-In</td></tr>
            </table>
          </div>
          <div style="margin-bottom:24px;">
            <h2 style="color:#1a1a1a;font-size:16px;margin-bottom:8px;">What to Expect</h2>
            <p style="color:#555;font-size:13px;line-height:1.6;">A LISTD Pro will attend the property on the scheduled date to conduct a thorough check-in inspection. This involves documenting the condition of each room, fixtures, fittings, and any furnishings. The inspection typically takes 1–3 hours depending on the size of the property.</p>
            <p style="color:#555;font-size:13px;line-height:1.6;margin-top:8px;">Please ensure access to the property is available at the scheduled time. If you have any questions or need to make changes, please contact us as soon as possible.</p>
          </div>
          <div style="border-top:1px solid #e5e5e5;padding-top:16px;margin-top:24px;">
            <p style="color:#888;font-size:12px;margin:0;">LISTD : Property Inventory Services<br/>Email: hello@listd.co.uk<br/>Website: listd.co.uk</p>
          </div>
        </div>
      `.trim()

      const { data, error } = await getResend().emails.send({
        from: FROM_NOTIFICATIONS,
        to: [tenant.email],
        subject,
        html,
      })

      await logEmail({
        functionName: 'notify-tenant-checkin',
        recipientEmails: [tenant.email],
        subject,
        resendId: data?.id ?? null,
        errorMessage: error ? error.message : null,
        metadata: { jobId, tenantOrder: tenant.tenantOrder },
      })

      if (!error) emailsSent.push(tenant.email)
    }

    return ok({ success: true, emailsSent })
  } catch (err) {
    return errorResponse(err)
  }
}
