import { badRequest, errorResponse, notFound, ok, serverError } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import { emailLogs, withServiceRole } from '@/db'
import { callerIp, callerUserAgent, logAuditEvent } from '@/lib/audit'
import { buildRecoveryLink } from '@/lib/auth/recovery-link'
import { trustedAppOrigin } from '@/lib/hosts'
import { FROM_TRANSACTIONAL, getResend } from '@/lib/resend'
import { getSupabaseAdmin } from '@/lib/supabase/admin'

export const maxDuration = 15
export const runtime = 'nodejs'

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Params = Promise<{ userId: string }>

/**
 * POST /api/admin/users/[userId]/password-reset — an admin initiates a
 * password reset for a clerk or client.
 *
 * Mirrors the self-service flow at
 * [/api/auth/password-reset](../../../../auth/password-reset/route.ts) — same
 * Supabase `generateLink({ type: 'recovery' })` + Resend delivery + email_logs
 * row — but is admin-gated and keyed on the target user id rather than an
 * attacker-supplied email, so:
 *   - no rate-limit / existence-masking is needed (the caller is a trusted,
 *     authorized admin acting on a user they can already see), and
 *   - it writes an `account_status / password_reset.initiated` audit row so
 *     the admin action is on the forensic trail.
 *
 * The email is resolved from Supabase Auth (`auth.users`, not reachable via
 * Drizzle); the reset link lands on the desktop `/reset-password` page.
 */
export async function POST(req: Request, { params }: { params: Params }) {
  const session = await authorizeRequest('admin')
  if (session instanceof Response) return session

  try {
    const { userId } = await params
    if (!UUID_RE.test(userId)) return badRequest('Invalid user id')

    const admin = getSupabaseAdmin()

    // Resolve the target's email from the auth schema.
    const { data: userData, error: getUserErr } =
      await admin.auth.admin.getUserById(userId)
    const email = userData?.user?.email
    if (getUserErr || !email) return notFound('User not found')

    // redirectTo only matters for the fallback action_link (older auth
    // servers); the emailed link is normally built by buildRecoveryLink below.
    // Supabase enforces its own redirect allow-list on redirectTo, so a bogus
    // origin falls back to the project Site URL.
    const origin =
      req.headers.get('origin') ??
      process.env.NEXT_PUBLIC_SITE_URL ??
      'https://listd.pro'
    const redirectUrl = `${origin}/reset-password`

    const subject = 'Reset your LISTD password'

    const { data, error: linkError } = await admin.auth.admin.generateLink({
      type: 'recovery',
      email,
      options: { redirectTo: redirectUrl },
    })
    // Emailed link carries the token hash, so it must point at the fixed app
    // origin rather than anything derived from request headers.
    const resetLink = linkError
      ? null
      : buildRecoveryLink(trustedAppOrigin(req.url), data?.properties)
    if (!resetLink) {
      return serverError('Could not generate the reset link')
    }

    const html = `
      <!DOCTYPE html>
      <html><head><meta charset="utf-8"></head>
      <body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 20px;">
          <tr><td align="center">
            <table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 6px rgba(0,0,0,.1);">
              <tr><td style="background:linear-gradient(135deg,#0F172A,#1E293B);padding:32px;text-align:center;"><h1 style="margin:0;color:#fff;font-size:28px;font-weight:700;">LISTD</h1></td></tr>
              <tr><td style="padding:40px 32px;">
                <h2 style="margin:0 0 16px;color:#0F172A;font-size:20px;font-weight:600;">Reset Your Password</h2>
                <p style="margin:0 0 24px;color:#64748B;font-size:15px;line-height:1.6;">A LISTD administrator started a password reset for your account. Click the button below to choose a new password.</p>
                <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:8px 0 24px;">
                  <a href="${resetLink}" style="display:inline-block;background:#F59E0B;color:#0F172A;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:600;font-size:15px;">Reset Password</a>
                </td></tr></table>
                <p style="margin:0 0 16px;color:#64748B;font-size:14px;line-height:1.6;">This link expires in 1 hour. If you weren't expecting this, you can safely ignore this email : your password won't change until you use the link.</p>
                <hr style="border:none;border-top:1px solid #E2E8F0;margin:24px 0;">
                <p style="margin:0;color:#94A3B8;font-size:13px;">If the button doesn't work, copy and paste this link into your browser:</p>
                <p style="margin:8px 0 0;color:#64748B;font-size:12px;word-break:break-all;">${resetLink}</p>
              </td></tr>
              <tr><td style="background:#F8FAFC;padding:24px 32px;text-align:center;"><p style="margin:0;color:#94A3B8;font-size:13px;">&copy; ${new Date().getFullYear()} LISTD. All rights reserved.</p></td></tr>
            </table>
          </td></tr>
        </table>
      </body></html>
    `.trim()

    const { data: emailData, error: emailError } = await getResend().emails.send(
      { from: FROM_TRANSACTIONAL, to: [email], subject, html }
    )
    const resendId = emailData?.id ?? null

    // Log the delivery attempt + the admin action in one tx (service-role:
    // email_logs / audit_events are admin-read-only under RLS, per ADR-001).
    const ip = callerIp(req)
    const ua = callerUserAgent(req)
    await withServiceRole(async (tx) => {
      await tx.insert(emailLogs).values({
        functionName: 'admin-password-reset',
        recipientEmail: email,
        subject,
        status: !emailError && resendId ? 'sent' : 'failed',
        resendId,
        errorMessage: emailError
          ? (emailError.message ?? JSON.stringify(emailError))
          : null,
        metadata: { initiatedByAdmin: session.userId, targetUserId: userId },
      })

      await logAuditEvent(tx, {
        category: 'account_status',
        action: 'password_reset.initiated',
        actorUserId: session.userId,
        targetType: 'profile',
        targetId: userId,
        payload: { email, resendId, via: 'admin' },
        ipAddress: ip,
        userAgent: ua,
      })
    })

    if (emailError || !resendId) {
      return serverError('Reset link created but the email failed to send')
    }

    return ok({ success: true, email })
  } catch (err) {
    console.error('[admin/users/password-reset] error:', err)
    return errorResponse(err)
  }
}
