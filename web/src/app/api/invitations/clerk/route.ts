import { z } from 'zod'
import { errorResponse, escapeHtml, ok, serverError } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import { FROM_NOTIFICATIONS, getResend, logEmail } from '@/lib/resend'

export const maxDuration = 15
export const runtime = 'nodejs'

const RequestSchema = z.object({
  email: z.string().trim().email().max(254),
  providerName: z.string().trim().max(255).optional().default(''),
  inviteToken: z.string().trim().uuid('Invalid invite token'),
})

/**
 * POST /api/invitations/clerk — send a clerk invitation email.
 * Replaces supabase/functions/send-clerk-invite/index.ts.
 *
 * Caller must be authenticated. The invitation token is generated and stored
 * in `clerk_invitations` by an upstream call (e.g. an organisation owner
 * inviting a clerk via the dashboard).
 */
export async function POST(req: Request) {
  const session = await authorizeRequest()
  if (session instanceof Response) return session

  try {
    const body = await req.json()
    const { email, providerName, inviteToken } = RequestSchema.parse(body)

    const origin = req.headers.get('origin') ?? process.env.NEXT_PUBLIC_SITE_URL ?? 'https://listd.co.uk'
    const inviteUrl = `${origin}/accept-invite?token=${encodeURIComponent(inviteToken)}`
    const safeProvider = escapeHtml(providerName || 'An inventory provider')
    const safeUrl = escapeHtml(inviteUrl)
    const subject = `${providerName || 'An inventory provider'} has invited you to join their team on LISTD`

    const html = `
      <!DOCTYPE html>
      <html><head><meta charset="utf-8"></head>
      <body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.6;color:#333;max-width:600px;margin:0 auto;padding:20px;">
        <div style="text-align:center;margin-bottom:30px;"><h1 style="color:#1a1a1a;margin-bottom:10px;">You're Invited!</h1></div>
        <div style="background:#f8f9fa;border-radius:12px;padding:30px;margin-bottom:30px;">
          <p style="font-size:16px;margin-bottom:20px;"><strong>${safeProvider}</strong> has invited you to join their team as a Pro on LISTD.</p>
          <p style="font-size:14px;color:#666;margin-bottom:25px;">As a Pro, you'll conduct property inspections, capture photos, and submit detailed inventory reports.</p>
          <div style="text-align:center;">
            <a href="${safeUrl}" style="display:inline-block;background:#0066FF;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:16px;">Accept Invitation</a>
          </div>
        </div>
        <p style="font-size:12px;color:#999;text-align:center;">This invitation expires in 7 days. If you didn't expect this, you can safely ignore this email.</p>
        <div style="text-align:center;margin-top:30px;padding-top:20px;border-top:1px solid #eee;"><p style="font-size:12px;color:#999;">&copy; ${new Date().getFullYear()} LISTD. All rights reserved.</p></div>
      </body></html>
    `.trim()

    const { data, error } = await getResend().emails.send({
      from: FROM_NOTIFICATIONS,
      to: [email],
      subject,
      html,
    })

    const resendId = data?.id ?? null
    await logEmail({
      functionName: 'send-clerk-invite',
      recipientEmails: [email],
      subject,
      resendId,
      errorMessage: error ? error.message : null,
      metadata: { inviteToken, invitedBy: session.userId },
    })

    if (error) return serverError('Email delivery failed')
    return ok({ success: true, resendId })
  } catch (err) {
    return errorResponse(err)
  }
}
