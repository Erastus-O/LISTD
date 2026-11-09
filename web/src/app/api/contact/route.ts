import { z } from 'zod'
import {
  errorResponse,
  noContent,
  serverError,
} from '@/lib/api'
import { callerIp } from '@/lib/audit'
import { rateLimitOrResponse } from '@/lib/rate-limit'
import {
  FROM_CONTACT,
  REPLY_TO_DEFAULT,
  getResend,
} from '@/lib/resend'

export const maxDuration = 15
export const runtime = 'nodejs'

const ContactSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  email: z.string().trim().email('Valid email required').max(254),
  company: z.string().trim().max(120).optional().or(z.literal('')),
  message: z.string().trim().min(1, 'Message is required').max(5000),
})

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export async function POST(req: Request) {
  // Public form — 5 submissions per hour per IP is generous for legitimate
  // users while making this a poor target for spambots that submit hundreds
  // of times per minute. The Resend send happens after this gate, so we're
  // also protecting against email-quota burn from spam waves.
  const limited = await rateLimitOrResponse({
    scope: 'contact-form',
    identifier: callerIp(req) ?? 'anon',
    limit: 5,
    windowSeconds: 60 * 60,
  })
  if (limited) return limited

  try {
    const body = await req.json()
    const { name, email, company, message } = ContactSchema.parse(body)

    const safeName = escapeHtml(name)
    const safeEmail = escapeHtml(email)
    const safeCompany = company ? escapeHtml(company) : '—'
    const safeMessage = escapeHtml(message)

    const html = `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #1a1a1a;">New Contact Form Submission</h2>
        <table style="width: 100%; border-collapse: collapse; margin-top: 16px;">
          <tr>
            <td style="padding: 8px; font-weight: bold; color: #555; width: 120px;">Name:</td>
            <td style="padding: 8px; color: #1a1a1a;">${safeName}</td>
          </tr>
          <tr style="background: #f9f9f9;">
            <td style="padding: 8px; font-weight: bold; color: #555;">Email:</td>
            <td style="padding: 8px; color: #1a1a1a;">
              <a href="mailto:${safeEmail}">${safeEmail}</a>
            </td>
          </tr>
          <tr>
            <td style="padding: 8px; font-weight: bold; color: #555;">Company:</td>
            <td style="padding: 8px; color: #1a1a1a;">${safeCompany}</td>
          </tr>
        </table>
        <div style="margin-top: 20px; padding: 16px; background: #f5f5f5; border-left: 3px solid #2d6a4f; border-radius: 4px;">
          <p style="margin: 0; font-weight: bold; color: #555; margin-bottom: 8px;">Message:</p>
          <p style="margin: 0; color: #1a1a1a; white-space: pre-wrap;">${safeMessage}</p>
        </div>
        <p style="margin-top: 20px; font-size: 12px; color: #999;">Sent from listd.co.uk contact form</p>
      </div>
    `.trim()

    const subject = `New enquiry from ${name}${company ? ` – ${company}` : ''}`

    const { error } = await getResend().emails.send({
      from: FROM_CONTACT,
      to: [REPLY_TO_DEFAULT],
      replyTo: email,
      subject,
      html,
    })

    if (error) {
      console.error('[contact] Resend error:', error)
      return serverError('Email delivery failed')
    }

    return noContent()
  } catch (err) {
    return errorResponse(err)
  }
}
