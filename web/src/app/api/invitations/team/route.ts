import { z } from 'zod'
import { errorResponse, escapeHtml, ok, serverError } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import { FROM_TRANSACTIONAL, getResend, logEmail } from '@/lib/resend'

export const maxDuration = 15
export const runtime = 'nodejs'

const RequestSchema = z.object({
  email: z.string().trim().email().max(254),
  organisationName: z.string().trim().min(1).max(255),
  inviteToken: z.string().trim().uuid('Invalid invite token'),
  inviterName: z.string().trim().max(255).default(''),
})

/**
 * POST /api/invitations/team — invite a team member to an organisation.
 * Replaces supabase/functions/send-team-invite/index.ts.
 *
 * Caller must be authenticated. The invitation token is generated and stored
 * in `organisation_members` (or similar) by an upstream call.
 */
export async function POST(req: Request) {
  const session = await authorizeRequest()
  if (session instanceof Response) return session

  try {
    const body = await req.json()
    const { email, organisationName, inviteToken, inviterName } =
      RequestSchema.parse(body)

    const origin =
      process.env.NEXT_PUBLIC_SITE_URL ?? 'https://listd.co.uk'
    const signupUrl = `${origin}/auth?invite=team&token=${encodeURIComponent(inviteToken)}`
    const safeUrl = escapeHtml(signupUrl)
    const safeOrg = escapeHtml(organisationName)
    const safeInviter = escapeHtml(inviterName || 'A team member')

    const subject = `You've been invited to join ${organisationName} on LISTD`
    const html = `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;padding:40px 20px;">
        <h1 style="color:#1a1a1a;font-size:24px;margin-bottom:16px;">You're Invited!</h1>
        <p style="color:#555;font-size:16px;line-height:1.5;">${safeInviter} has invited you to join <strong>${safeOrg}</strong> on LISTD.</p>
        <p style="color:#555;font-size:16px;line-height:1.5;">As a team member, you'll be able to create and manage inventory inspection bookings for your organisation.</p>
        <div style="margin:32px 0;">
          <a href="${safeUrl}" style="background-color:#22c55e;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:16px;">Accept Invitation</a>
        </div>
        <p style="color:#999;font-size:14px;">If you didn't expect this invitation, you can safely ignore this email.</p>
      </div>
    `.trim()

    const { data, error } = await getResend().emails.send({
      from: FROM_TRANSACTIONAL,
      to: [email],
      subject,
      html,
    })

    await logEmail({
      functionName: 'send-team-invite',
      recipientEmails: [email],
      subject: `Team invitation to ${organisationName}`,
      resendId: data?.id ?? null,
      errorMessage: error ? error.message : null,
      metadata: { inviteToken, organisationName, invitedBy: session.userId },
    })

    if (error) return serverError('Email delivery failed')
    return ok({ success: true })
  } catch (err) {
    return errorResponse(err)
  }
}
