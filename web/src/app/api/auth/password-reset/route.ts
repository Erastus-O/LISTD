import { z } from 'zod'
import { badRequest, errorResponse, ok, serverError } from '@/lib/api'
import { callerIp } from '@/lib/audit'
import { emailLogs, withServiceRole } from '@/db'
import { buildRecoveryLink } from '@/lib/auth/recovery-link'
import { APP_HOST, WWW_HOST, trustedAppOrigin } from '@/lib/hosts'
import { rateLimitOrResponse } from '@/lib/rate-limit'
import { FROM_TRANSACTIONAL, getResend } from '@/lib/resend'
import { getSupabaseAdmin } from '@/lib/supabase/admin'

export const maxDuration = 15
export const runtime = 'nodejs'

// The reset form sends `${window.location.origin}/reset-password`, so the
// app host must be here: /auth and /reset-password are served from it.
const ALLOWED_REDIRECT_HOSTS = new Set([
  'listd.co.uk',
  WWW_HOST,
  APP_HOST,
  'listd.app',
  'localhost',
])

function isAllowedRedirectHost(hostname: string): boolean {
  if (ALLOWED_REDIRECT_HOSTS.has(hostname)) return true
  if (hostname.endsWith('.lovable.app')) return true
  if (hostname.endsWith('.lovableproject.com')) return true
  if (hostname.endsWith('.vercel.app')) return true
  return false
}

const RequestSchema = z.object({
  email: z.string().trim().email('Valid email required').max(254),
  redirectUrl: z.string().trim().url('Valid redirectUrl required'),
})

export async function POST(req: Request) {
  // Rate-limit by IP, not email — the email field is attacker-controlled, so
  // limiting by email lets a single IP enumerate every account at full speed.
  // 5 hits per 10 min slows enumeration meaningfully while leaving headroom
  // for a legitimate user who mistypes their email a couple of times.
  const limited = await rateLimitOrResponse({
    scope: 'auth-password-reset',
    identifier: callerIp(req) ?? 'anon',
    limit: 5,
    windowSeconds: 10 * 60,
  })
  if (limited) return limited

  try {
    const body = await req.json()
    const { email, redirectUrl } = RequestSchema.parse(body)

    const parsed = new URL(redirectUrl)
    if (!isAllowedRedirectHost(parsed.hostname)) {
      return badRequest('Redirect host not allowed')
    }

    const subject = 'Reset your LISTD password'

    // RLS bypass: this is a public endpoint logging email-delivery attempts
    // for an unauthenticated caller; the email_logs RLS policy is admin-only
    // for reads, so writes happen via the service-role path. Per ADR-001.
    const logEmailAttempt = (
      status: 'sent' | 'failed',
      resendId: string | null,
      errorMessage: string | null
    ) =>
      withServiceRole(async (tx) =>
        tx.insert(emailLogs).values({
          functionName: 'send-password-reset',
          recipientEmail: email,
          subject,
          status,
          resendId,
          errorMessage,
          metadata: {},
        })
      )

    // Generate the recovery link via Supabase admin API (auth schema, not
    // reachable via Drizzle — service-role Supabase client is required).
    const admin = getSupabaseAdmin()
    const { data, error: linkError } = await admin.auth.admin.generateLink({
      type: 'recovery',
      email,
      options: { redirectTo: redirectUrl },
    })

    if (linkError) {
      await logEmailAttempt('failed', null, `Link generation failed: ${linkError.message}`)
      // Return success to avoid leaking whether the email exists.
      return ok({ success: true })
    }

    // Built on the fixed app origin, never the caller's redirectUrl or Host
    // header: the link carries the token hash (see buildRecoveryLink).
    const resetLink = buildRecoveryLink(trustedAppOrigin(req.url), data?.properties)
    if (!resetLink) {
      await logEmailAttempt('failed', null, 'No recovery link returned by Supabase')
      return ok({ success: true })
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
                <p style="margin:0 0 24px;color:#64748B;font-size:15px;line-height:1.6;">We received a request to reset your password. Click the button below to choose a new one.</p>
                <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:8px 0 24px;">
                  <a href="${resetLink}" style="display:inline-block;background:#F59E0B;color:#0F172A;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:600;font-size:15px;">Reset Password</a>
                </td></tr></table>
                <p style="margin:0 0 16px;color:#64748B;font-size:14px;line-height:1.6;">This link expires in 1 hour. If you didn't request this, you can safely ignore this email.</p>
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

    const { data: emailData, error: emailError } = await getResend().emails.send({
      from: FROM_TRANSACTIONAL,
      to: [email],
      subject,
      html,
    })

    if (emailError) {
      await logEmailAttempt(
        'failed',
        null,
        emailError.message ?? JSON.stringify(emailError)
      )
      return ok({ success: true })
    }

    const resendId = emailData?.id ?? null
    await logEmailAttempt(resendId ? 'sent' : 'failed', resendId, null)

    return ok({ success: true })
  } catch (err) {
    console.error('[password-reset] error:', err)
    if (err instanceof z.ZodError) return errorResponse(err)
    return serverError('An internal error occurred')
  }
}
