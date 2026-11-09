import { z } from 'zod'
import { errorResponse, escapeHtml, ok } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import { FROM_NOTIFICATIONS, getResend, logEmail } from '@/lib/resend'

export const maxDuration = 15
export const runtime = 'nodejs'

const ADMIN_EMAIL = 'hello@listd.co.uk'

const SignupSchema = z.object({
  type: z.literal('signup'),
  userName: z.string().optional(),
  userEmail: z.string().optional(),
  userRole: z.string().optional(),
})
const JobPostedSchema = z.object({
  type: z.literal('job_posted'),
  jobId: z.string().optional(),
  propertyAddress: z.string().optional(),
  city: z.string().optional(),
  postcode: z.string().optional(),
  inspectionType: z.string().optional(),
  scheduledDate: z.string().optional(),
})
const IbSyncSchema = z.object({
  type: z.literal('ib_sync'),
  totalEvents: z.number().optional(),
  matchedCount: z.number().optional(),
})
const WaitlistLeadSchema = z.object({
  type: z.literal('waitlist_lead'),
  leadName: z.string().optional(),
  leadEmail: z.string().optional(),
  leadCompany: z.string().optional(),
  leadPhone: z.string().optional(),
  leadRole: z.string().optional(),
  leadPortfolioSize: z.string().optional(),
  leadMonthlyVolume: z.string().optional(),
})

const RequestSchema = z.discriminatedUnion('type', [
  SignupSchema,
  JobPostedSchema,
  IbSyncSchema,
  WaitlistLeadSchema,
])

type AdminPayload = z.infer<typeof RequestSchema>

const SITE_URL = () =>
  process.env.NEXT_PUBLIC_SITE_URL ?? 'https://listd.co.uk'

function wrap(title: string, body: string): string {
  const year = new Date().getFullYear()
  return `
    <!DOCTYPE html>
    <html><head><meta charset="utf-8"></head>
    <body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;margin:0;padding:0;background:#f4f4f5;">
      <div style="max-width:600px;margin:0 auto;padding:20px;">
        <div style="background:#fff;border-radius:12px;padding:32px;box-shadow:0 1px 3px rgba(0,0,0,.1);">
          <div style="text-align:center;margin-bottom:24px;"><h1 style="color:#18181b;font-size:22px;margin:0;">${escapeHtml(title)}</h1></div>
          ${body}
        </div>
        <div style="text-align:center;margin-top:20px;"><p style="color:#a1a1aa;font-size:12px;">&copy; ${year} LISTD. All rights reserved.</p></div>
      </div>
    </body></html>
  `.trim()
}

function buildEmail(p: AdminPayload): { subject: string; html: string } {
  const adminLink = `${SITE_URL()}/admin/dashboard`
  const cta = `<div style="text-align:center;margin-top:24px;"><a href="${escapeHtml(adminLink)}" style="display:inline-block;background:#0d9488;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;font-size:14px;">View in Admin Panel</a></div>`

  switch (p.type) {
    case 'signup': {
      const name = escapeHtml(p.userName ?? 'Unknown')
      const email = escapeHtml(p.userEmail ?? '—')
      const role = escapeHtml(p.userRole ?? '—')
      return {
        subject: `🆕 New Sign-Up: ${p.userName ?? 'Unknown'} (${p.userRole ?? '—'})`,
        html: wrap(
          'New User Sign-Up',
          `<table style="width:100%;border-collapse:collapse;">
            <tr><td style="padding:8px 0;color:#71717a;font-size:14px;">Name:</td><td style="padding:8px 0;color:#18181b;font-size:14px;font-weight:600;">${name}</td></tr>
            <tr><td style="padding:8px 0;color:#71717a;font-size:14px;">Email:</td><td style="padding:8px 0;color:#18181b;font-size:14px;">${email}</td></tr>
            <tr><td style="padding:8px 0;color:#71717a;font-size:14px;">Role:</td><td style="padding:8px 0;color:#18181b;font-size:14px;">${role}</td></tr>
          </table>${cta}`
        ),
      }
    }

    case 'job_posted': {
      const address = escapeHtml(p.propertyAddress ?? '—')
      const city = escapeHtml(p.city ?? '')
      const postcode = escapeHtml(p.postcode ?? '')
      const type = escapeHtml(p.inspectionType?.replace(/_/g, ' ') ?? '—')
      const dateStr = p.scheduledDate
        ? new Date(p.scheduledDate).toLocaleDateString('en-GB', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          })
        : '—'
      return {
        subject: `📋 New Job Posted: ${p.inspectionType?.replace(/_/g, ' ') ?? '—'} in ${p.city ?? 'Unknown'}`,
        html: wrap(
          'New Job Posted',
          `<div style="background:#f4f4f5;border-radius:8px;padding:20px;margin-bottom:24px;">
            <table style="width:100%;border-collapse:collapse;">
              <tr><td style="padding:8px 0;color:#71717a;font-size:14px;">Type:</td><td style="padding:8px 0;color:#18181b;font-size:14px;font-weight:600;">${type}</td></tr>
              <tr><td style="padding:8px 0;color:#71717a;font-size:14px;">Property:</td><td style="padding:8px 0;color:#18181b;font-size:14px;">${address}</td></tr>
              <tr><td style="padding:8px 0;color:#71717a;font-size:14px;">Location:</td><td style="padding:8px 0;color:#18181b;font-size:14px;">${city}, ${postcode}</td></tr>
              <tr><td style="padding:8px 0;color:#71717a;font-size:14px;">Date:</td><td style="padding:8px 0;color:#18181b;font-size:14px;">${escapeHtml(dateStr)}</td></tr>
            </table>
          </div>${cta}`
        ),
      }
    }

    case 'ib_sync':
      return {
        subject: `🔄 IB Sync Complete: ${p.totalEvents ?? 0} events, ${p.matchedCount ?? 0} matched`,
        html: wrap(
          'InventoryBase Sync Complete',
          `<div style="background:#f4f4f5;border-radius:8px;padding:20px;margin-bottom:24px;">
            <table style="width:100%;border-collapse:collapse;">
              <tr><td style="padding:8px 0;color:#71717a;font-size:14px;">Total Events:</td><td style="padding:8px 0;color:#18181b;font-size:14px;font-weight:600;">${p.totalEvents ?? 0}</td></tr>
              <tr><td style="padding:8px 0;color:#71717a;font-size:14px;">Auto-Matched:</td><td style="padding:8px 0;color:#18181b;font-size:14px;font-weight:600;">${p.matchedCount ?? 0}</td></tr>
            </table>
          </div>${cta}`
        ),
      }

    case 'waitlist_lead': {
      const name = escapeHtml(p.leadName ?? 'Unknown')
      const email = escapeHtml(p.leadEmail ?? '—')
      const company = escapeHtml(p.leadCompany ?? '—')
      const phone = escapeHtml(p.leadPhone ?? '—')
      const role = escapeHtml(p.leadRole ?? '—')
      const portfolio = escapeHtml(p.leadPortfolioSize ?? 'Not specified')
      const volume = escapeHtml(p.leadMonthlyVolume ?? 'Not specified')
      const submittedAt = escapeHtml(
        new Date().toLocaleString('en-GB', {
          dateStyle: 'long',
          timeStyle: 'short',
        })
      )
      return {
        subject: `🚀 New Early Access Request: ${p.leadName ?? 'Unknown'} – ${p.leadCompany ?? ''}`,
        html: wrap(
          'New Early Access Request',
          `<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:16px;margin-bottom:20px;">
            <p style="margin:0;color:#15803d;font-size:13px;font-weight:600;">⚡ New waitlist lead submitted on ${submittedAt}</p>
          </div>
          <div style="background:#f4f4f5;border-radius:8px;padding:20px;margin-bottom:24px;">
            <table style="width:100%;border-collapse:collapse;">
              <tr><td style="padding:7px 0;color:#71717a;font-size:13px;width:40%;">Name:</td><td style="padding:7px 0;color:#18181b;font-size:13px;font-weight:600;">${name}</td></tr>
              <tr><td style="padding:7px 0;color:#71717a;font-size:13px;">Company:</td><td style="padding:7px 0;color:#18181b;font-size:13px;font-weight:600;">${company}</td></tr>
              <tr><td style="padding:7px 0;color:#71717a;font-size:13px;">Email:</td><td style="padding:7px 0;color:#18181b;font-size:13px;"><a href="mailto:${email}" style="color:#0d9488;">${email}</a></td></tr>
              <tr><td style="padding:7px 0;color:#71717a;font-size:13px;">Phone:</td><td style="padding:7px 0;color:#18181b;font-size:13px;">${phone}</td></tr>
              <tr><td style="padding:7px 0;color:#71717a;font-size:13px;">Role:</td><td style="padding:7px 0;color:#18181b;font-size:13px;">${role}</td></tr>
              <tr><td style="padding:7px 0;color:#71717a;font-size:13px;">Portfolio Size:</td><td style="padding:7px 0;color:#18181b;font-size:13px;">${portfolio}</td></tr>
              <tr><td style="padding:7px 0;color:#71717a;font-size:13px;">Monthly Volume:</td><td style="padding:7px 0;color:#18181b;font-size:13px;">${volume}</td></tr>
            </table>
          </div>${cta}`
        ),
      }
    }
  }
}

/**
 * POST /api/notifications/admin — multiplexed admin notification email.
 * Replaces supabase/functions/notify-admin/index.ts.
 *
 * Authentication tightened during port: the original was unauthenticated,
 * which let any caller send admin emails. We now require an authenticated
 * Supabase session. Server-to-server callers (cron, webhooks) should hit
 * the underlying email send directly with `withServiceRole` rather than
 * this route, since they don't have a user session.
 */
export async function POST(req: Request) {
  const session = await authorizeRequest()
  if (session instanceof Response) return session

  try {
    const body = await req.json()
    const payload = RequestSchema.parse(body)
    const { subject, html } = buildEmail(payload)

    const { data, error } = await getResend().emails.send({
      from: FROM_NOTIFICATIONS,
      to: [ADMIN_EMAIL],
      subject,
      html,
    })

    await logEmail({
      functionName: 'notify-admin',
      recipientEmails: [ADMIN_EMAIL],
      subject,
      resendId: data?.id ?? null,
      errorMessage: error ? error.message : null,
      metadata: { type: payload.type, triggeredBy: session.userId },
    })

    return ok({ success: !error, id: data?.id ?? null })
  } catch (err) {
    return errorResponse(err)
  }
}
