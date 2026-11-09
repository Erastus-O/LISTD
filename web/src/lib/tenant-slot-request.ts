import 'server-only'
import { asc, eq } from 'drizzle-orm'
import { db, jobs, properties, tenantDetails } from '@/db'
import { escapeHtml } from '@/lib/api'
import { FROM_NOTIFICATIONS, getResend, logEmail } from '@/lib/resend'
import { issueTenantToken } from '@/lib/tenant-tokens'
import { isTimeframe, timeframeLabel, timeframeWindow } from '@/lib/scheduling/slots'

/**
 * Email the primary tenant their inspection slot-picker link once a clerk
 * accepts the job. They choose 30-minute slots within the timeframe the client
 * booked. Best-effort; never throws into the accept flow. Call AFTER the accept
 * transaction commits.
 *
 * No-ops when the job has no specific timeframe (e.g. "flexible") or the
 * primary tenant has no email on file.
 */
export async function emailPrimaryTenantSlotRequest(params: {
  jobId: string
  issuedBy?: string
}): Promise<{ sent: boolean; reason?: string }> {
  const [job] = await db
    .select({
      preferredTimeSlot: jobs.preferredTimeSlot,
      scheduledDate: jobs.scheduledDate,
      addressLine1: properties.addressLine1,
      postcode: properties.postcode,
    })
    .from(jobs)
    .leftJoin(properties, eq(properties.id, jobs.propertyId))
    .where(eq(jobs.id, params.jobId))
    .limit(1)
  if (!job) return { sent: false, reason: 'job_not_found' }
  if (!isTimeframe(job.preferredTimeSlot)) {
    return { sent: false, reason: 'no_timeframe' }
  }

  // Primary tenant = lowest tenant_order with an email.
  const tenants = await db
    .select({
      id: tenantDetails.id,
      fullName: tenantDetails.fullName,
      email: tenantDetails.email,
    })
    .from(tenantDetails)
    .where(eq(tenantDetails.jobId, params.jobId))
    .orderBy(asc(tenantDetails.tenantOrder))
  const primary = tenants.find((t) => t.email && t.email.includes('@'))
  if (!primary?.email) return { sent: false, reason: 'no_tenant_email' }

  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL ?? 'https://listd-pro.vercel.app'
  const address = job.addressLine1
    ? `${job.addressLine1}${job.postcode ? ', ' + job.postcode : ''}`
    : 'your property'
  const safeAddress = escapeHtml(address)
  const dateLabel = job.scheduledDate
    ? new Date(job.scheduledDate).toLocaleDateString('en-GB', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
      })
    : ''
  const window = timeframeWindow(job.preferredTimeSlot)
  const tf = `${timeframeLabel(job.preferredTimeSlot)}${window ? ` (${window})` : ''}`

  try {
    const { token } = await issueTenantToken({
      jobId: params.jobId,
      tenantDetailId: primary.id,
      scope: ['view_report', 'sign_report', 'download_report'],
      issuedBy: params.issuedBy,
    })
    const link = `${siteUrl}/tenant/portal/slots?token=${encodeURIComponent(token)}`
    const greeting = primary.fullName ? ` ${escapeHtml(primary.fullName)}` : ''
    const subject = `Choose your inspection time : ${address}`

    const html = `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
        <h1 style="color:#1a1a1a;font-size:22px;margin-bottom:8px;">Pick your inspection time</h1>
        <p style="color:#666;font-size:14px;margin-bottom:20px;">Hello${greeting}, a clerk has been assigned to the inspection at <strong>${safeAddress}</strong>. Please choose the 30-minute time slot(s) that suit you.</p>
        <div style="background:#f8f9fa;border-radius:8px;padding:16px;margin-bottom:20px;">
          <p style="margin:0 0 4px;color:#888;font-size:13px;">Date</p>
          <p style="margin:0 0 12px;color:#1a1a1a;font-size:14px;font-weight:500;">${escapeHtml(dateLabel)}</p>
          <p style="margin:0 0 4px;color:#888;font-size:13px;">Time window</p>
          <p style="margin:0;color:#1a1a1a;font-size:14px;font-weight:500;">${escapeHtml(tf)}</p>
        </div>
        <div style="text-align:center;margin:24px 0;">
          <a href="${link}" style="display:inline-block;background:#10b981;color:#fff;text-decoration:none;font-size:15px;font-weight:600;padding:12px 28px;border-radius:8px;">Choose your time slot(s)</a>
        </div>
        <p style="color:#555;font-size:13px;line-height:1.6;">You can pick more than one slot to give the clerk options. The more you select, the easier it is to confirm a convenient time.</p>
        <p style="color:#888;font-size:12px;line-height:1.6;margin-top:16px;">This link is personal to you : please don't forward it.</p>
        <div style="border-top:1px solid #e5e5e5;padding-top:16px;margin-top:24px;">
          <p style="color:#888;font-size:12px;margin:0;">LISTD : Property Inventory Services<br/>Email: hello@listd.co.uk</p>
        </div>
      </div>
    `.trim()

    const { data, error } = await getResend().emails.send({
      from: FROM_NOTIFICATIONS,
      to: [primary.email],
      subject,
      html,
    })
    await logEmail({
      functionName: 'tenant-slot-request',
      recipientEmails: [primary.email],
      subject,
      resendId: data?.id ?? null,
      errorMessage: error ? error.message : null,
      metadata: { jobId: params.jobId },
    })
    return { sent: !error }
  } catch (err) {
    console.warn('[tenant-slot-request] failed:', err)
    return { sent: false, reason: 'error' }
  }
}
