import { z } from 'zod'
import { errorResponse, escapeHtml, ok, serverError } from '@/lib/api'
import { callerIp } from '@/lib/audit'
import { waitlistLeads, withServiceRole } from '@/db'
import { rateLimitOrResponse } from '@/lib/rate-limit'
import { FROM_NOTIFICATIONS, getResend, logEmail } from '@/lib/resend'

export const maxDuration = 15
export const runtime = 'nodejs'

const ADMIN_EMAIL = 'hello@listd.co.uk'

const RequestSchema = z.object({
  fullName: z.string().trim().min(1).max(100),
  companyName: z.string().trim().min(1).max(150),
  email: z.string().trim().email().max(255),
  phone: z.string().trim().max(30).optional().or(z.literal('')),
  role: z.string().trim().min(1).max(50),
  portfolioSize: z.string().trim().max(50).optional().or(z.literal('')),
  monthlyVolume: z.string().trim().max(50).optional().or(z.literal('')),
})

/**
 * POST /api/waitlist — record a public early-access lead and fire an admin
 * notification email.
 *
 * Public endpoint (no auth). The waitlist_leads RLS policy allows anonymous
 * inserts; we use service-role here for consistency with the rest of the
 * Drizzle data path. The admin notification email is the operationally
 * important side-effect.
 */
export async function POST(req: Request) {
  // Public form — 3 submissions per hour per IP. Tighter than the contact
  // form because waitlist leads write a DB row AND fire an admin email, so
  // each submission costs more than a contact-form one.
  const limited = await rateLimitOrResponse({
    scope: 'waitlist',
    identifier: callerIp(req) ?? 'anon',
    limit: 3,
    windowSeconds: 60 * 60,
  })
  if (limited) return limited

  try {
    const body = await req.json()
    const input = RequestSchema.parse(body)

    await withServiceRole(async (tx) =>
      tx.insert(waitlistLeads).values({
        fullName: input.fullName,
        companyName: input.companyName,
        email: input.email.toLowerCase(),
        phone: input.phone || null,
        role: input.role,
        portfolioSize: input.portfolioSize || null,
        monthlyVolume: input.monthlyVolume || null,
      })
    )

    // Fire-and-forget admin email — log but don't fail the response.
    void notifyAdmin(input).catch((err) =>
      console.error('[waitlist] admin notify failed:', err)
    )

    return ok({ success: true })
  } catch (err) {
    return errorResponse(err)
  }
}

async function notifyAdmin(lead: z.infer<typeof RequestSchema>) {
  const submittedAt = new Date().toLocaleString('en-GB', {
    dateStyle: 'long',
    timeStyle: 'short',
  })
  const safeName = escapeHtml(lead.fullName)
  const safeCompany = escapeHtml(lead.companyName)
  const safeEmail = escapeHtml(lead.email)
  const safePhone = escapeHtml(lead.phone || '—')
  const safeRole = escapeHtml(lead.role)
  const safePortfolio = escapeHtml(lead.portfolioSize || 'Not specified')
  const safeVolume = escapeHtml(lead.monthlyVolume || 'Not specified')
  const safeSubmittedAt = escapeHtml(submittedAt)

  const subject = `🚀 New Early Access Request: ${lead.fullName} – ${lead.companyName}`
  const html = `
    <!DOCTYPE html>
    <html><head><meta charset="utf-8"></head>
    <body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;margin:0;padding:0;background:#f4f4f5;">
      <div style="max-width:600px;margin:0 auto;padding:20px;">
        <div style="background:#fff;border-radius:12px;padding:32px;box-shadow:0 1px 3px rgba(0,0,0,.1);">
          <h1 style="color:#18181b;font-size:22px;margin:0 0 16px;text-align:center;">New Early Access Request</h1>
          <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:16px;margin-bottom:20px;">
            <p style="margin:0;color:#15803d;font-size:13px;font-weight:600;">⚡ New waitlist lead submitted on ${safeSubmittedAt}</p>
          </div>
          <div style="background:#f4f4f5;border-radius:8px;padding:20px;margin-bottom:24px;">
            <table style="width:100%;border-collapse:collapse;">
              <tr><td style="padding:7px 0;color:#71717a;font-size:13px;width:40%;">Name:</td><td style="padding:7px 0;color:#18181b;font-size:13px;font-weight:600;">${safeName}</td></tr>
              <tr><td style="padding:7px 0;color:#71717a;font-size:13px;">Company:</td><td style="padding:7px 0;color:#18181b;font-size:13px;font-weight:600;">${safeCompany}</td></tr>
              <tr><td style="padding:7px 0;color:#71717a;font-size:13px;">Email:</td><td style="padding:7px 0;color:#18181b;font-size:13px;"><a href="mailto:${safeEmail}" style="color:#0d9488;">${safeEmail}</a></td></tr>
              <tr><td style="padding:7px 0;color:#71717a;font-size:13px;">Phone:</td><td style="padding:7px 0;color:#18181b;font-size:13px;">${safePhone}</td></tr>
              <tr><td style="padding:7px 0;color:#71717a;font-size:13px;">Role:</td><td style="padding:7px 0;color:#18181b;font-size:13px;">${safeRole}</td></tr>
              <tr><td style="padding:7px 0;color:#71717a;font-size:13px;">Portfolio Size:</td><td style="padding:7px 0;color:#18181b;font-size:13px;">${safePortfolio}</td></tr>
              <tr><td style="padding:7px 0;color:#71717a;font-size:13px;">Monthly Volume:</td><td style="padding:7px 0;color:#18181b;font-size:13px;">${safeVolume}</td></tr>
            </table>
          </div>
          <div style="text-align:center;">
            <a href="${escapeHtml(process.env.NEXT_PUBLIC_SITE_URL ?? 'https://listd.co.uk')}/admin/dashboard" style="display:inline-block;background:#0d9488;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;font-size:14px;">View Waitlist in Admin Panel</a>
          </div>
        </div>
      </div>
    </body></html>
  `.trim()

  const { data, error } = await getResend().emails.send({
    from: FROM_NOTIFICATIONS,
    to: [ADMIN_EMAIL],
    subject,
    html,
  })

  await logEmail({
    functionName: 'waitlist',
    recipientEmails: [ADMIN_EMAIL],
    subject,
    resendId: data?.id ?? null,
    errorMessage: error ? error.message : null,
    metadata: { type: 'waitlist_lead', email: lead.email },
  })

  if (error) throw new Error(error.message)
}

// suppress unused-import warning for ServerError export usage in error paths
void serverError
