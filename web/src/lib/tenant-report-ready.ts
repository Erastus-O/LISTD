import 'server-only'
import { eq } from 'drizzle-orm'
import { db, tenantDetails } from '@/db'
import { escapeHtml } from '@/lib/api'
import { FROM_NOTIFICATIONS, getResend, logEmail } from '@/lib/resend'
import { issueTenantToken } from '@/lib/tenant-tokens'

/**
 * Email every tenant on a job their private sign-off link once the report is
 * ready (QA-approved). Mints a fresh tenant token per tenant (view/sign/
 * download scope) and sends the `/tenant/portal?token=…` link via Resend.
 *
 * Best-effort: each tenant is independent and wrapped so a single failure
 * (or an unconfigured Resend) never throws into the approve flow. Call AFTER
 * the approval transaction has committed.
 */
export async function emailTenantsReportReady(params: {
  jobId: string
  address: string
  issuedBy?: string
}): Promise<{ sent: number; tenants: number }> {
  const tenants = await db
    .select({
      id: tenantDetails.id,
      fullName: tenantDetails.fullName,
      email: tenantDetails.email,
      tenantOrder: tenantDetails.tenantOrder,
    })
    .from(tenantDetails)
    .where(eq(tenantDetails.jobId, params.jobId))

  const recipients = tenants.filter(
    (t): t is typeof t & { email: string } =>
      !!t.email && t.email.includes('@')
  )
  if (recipients.length === 0) return { sent: 0, tenants: 0 }

  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL ?? 'https://listd-pro.vercel.app'
  const safeAddress = escapeHtml(params.address)
  const subject = `Your inspection report is ready to sign : ${params.address}`

  let sent = 0
  for (const tenant of recipients) {
    try {
      const { token } = await issueTenantToken({
        jobId: params.jobId,
        tenantDetailId: tenant.id,
        scope: ['view_report', 'sign_report', 'download_report'],
        issuedBy: params.issuedBy,
      })
      const link = `${siteUrl}/tenant/portal?token=${encodeURIComponent(token)}`
      const greeting = tenant.fullName ? ` ${escapeHtml(tenant.fullName)}` : ''

      const html = `
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
          <h1 style="color:#1a1a1a;font-size:22px;margin-bottom:8px;">Your report is ready</h1>
          <p style="color:#666;font-size:14px;margin-bottom:20px;">Hello${greeting}, the inspection report for <strong>${safeAddress}</strong> is ready for you to review and sign.</p>
          <div style="text-align:center;margin:28px 0;">
            <a href="${link}" style="display:inline-block;background:#10b981;color:#fff;text-decoration:none;font-size:15px;font-weight:600;padding:12px 28px;border-radius:8px;">View &amp; sign your report</a>
          </div>
          <p style="color:#555;font-size:13px;line-height:1.6;">Open the report, check that it reflects the condition of the property, then type your name to sign it off. If anything looks wrong, you can raise a query before signing.</p>
          <p style="color:#888;font-size:12px;line-height:1.6;margin-top:16px;">This link is personal to you : please don't forward it. It stays active for 7 days; if it expires, ask the agent to resend it.</p>
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
        functionName: 'tenant-report-ready',
        recipientEmails: [tenant.email],
        subject,
        resendId: data?.id ?? null,
        errorMessage: error ? error.message : null,
        metadata: { jobId: params.jobId, tenantOrder: tenant.tenantOrder },
      })

      if (!error) sent += 1
    } catch (err) {
      console.warn('[tenant-report-ready] failed for tenant', tenant.id, err)
    }
  }

  return { sent, tenants: recipients.length }
}
