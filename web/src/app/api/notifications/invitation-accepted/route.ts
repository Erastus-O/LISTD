import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { errorResponse, escapeHtml, ok } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import { FROM_TRANSACTIONAL, getResend, logEmail } from '@/lib/resend'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import {
  notificationPreferences,
  profiles,
  withServiceRole,
} from '@/db'

export const maxDuration = 15
export const runtime = 'nodejs'

const RequestSchema = z.object({
  providerId: z.string().uuid(),
  clerkName: z.string().trim().max(255).default(''),
  clerkEmail: z.string().trim().email().max(254),
})

/**
 * POST /api/notifications/invitation-accepted — notify a provider that one of
 * their invited clerks has accepted the invitation.
 * Replaces supabase/functions/notify-invitation-accepted/index.ts.
 */
export async function POST(req: Request) {
  const session = await authorizeRequest()
  if (session instanceof Response) return session

  try {
    const body = await req.json()
    const { providerId, clerkName, clerkEmail } = RequestSchema.parse(body)

    const { providerProfile, optedOut } = await withServiceRole(async (tx) => {
      const [profile] = await tx
        .select({
          fullName: profiles.fullName,
          companyName: profiles.companyName,
        })
        .from(profiles)
        .where(eq(profiles.userId, providerId))
        .limit(1)

      const [pref] = await tx
        .select({ emailJobUpdates: notificationPreferences.emailJobUpdates })
        .from(notificationPreferences)
        .where(eq(notificationPreferences.userId, providerId))
        .limit(1)

      return {
        providerProfile: profile,
        optedOut: pref?.emailJobUpdates === false,
      }
    })

    if (optedOut) return ok({ success: true, skipped: true })

    const admin = getSupabaseAdmin()
    const {
      data: { user: providerUser },
      error: userError,
    } = await admin.auth.admin.getUserById(providerId)
    if (userError || !providerUser?.email) {
      throw new Error('Could not fetch provider email')
    }

    const providerEmail = providerUser.email
    const providerName =
      providerProfile?.fullName ||
      providerProfile?.companyName ||
      'Provider'
    const safeProvider = escapeHtml(providerName)
    const safeClerkName = escapeHtml(clerkName || clerkEmail)
    const safeClerkEmail = escapeHtml(clerkEmail)
    const subject = 'A clerk has joined your team!'

    const html = `
      <!DOCTYPE html>
      <html><head><meta charset="utf-8"></head>
      <body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.6;color:#333;max-width:600px;margin:0 auto;padding:20px;">
        <div style="background:linear-gradient(135deg,#10b981,#059669);padding:30px;border-radius:12px 12px 0 0;text-align:center;">
          <h1 style="color:#fff;margin:0;font-size:24px;">New Team Member!</h1>
        </div>
        <div style="background:#f9fafb;padding:30px;border-radius:0 0 12px 12px;border:1px solid #e5e7eb;border-top:none;">
          <p style="font-size:16px;margin-bottom:20px;">Hi ${safeProvider},</p>
          <p style="font-size:16px;margin-bottom:20px;">Great news! <strong>${safeClerkName}</strong> has accepted your invitation and joined your team on LISTD.</p>
          <div style="background:#fff;border-radius:8px;padding:20px;margin:20px 0;border:1px solid #e5e7eb;">
            <p style="margin:0;font-size:14px;color:#6b7280;">New Pro Details:</p>
            <p style="margin:8px 0 0;font-size:16px;font-weight:600;">${safeClerkName}</p>
            <p style="margin:4px 0 0;font-size:14px;color:#6b7280;">${safeClerkEmail}</p>
          </div>
          <p style="font-size:16px;margin-bottom:20px;">You can now assign inspection jobs to this clerk from your dashboard.</p>
          <div style="text-align:center;margin-top:30px;">
            <a href="${escapeHtml(process.env.NEXT_PUBLIC_SITE_URL ?? 'https://listd.co.uk')}/client/dashboard" style="display:inline-block;background:#10b981;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:600;">Go to Dashboard</a>
          </div>
          <p style="font-size:14px;color:#6b7280;margin-top:30px;text-align:center;">The LISTD Team</p>
        </div>
      </body></html>
    `.trim()

    const { data, error } = await getResend().emails.send({
      from: FROM_TRANSACTIONAL,
      to: [providerEmail],
      subject,
      html,
    })

    await logEmail({
      functionName: 'notify-invitation-accepted',
      recipientEmails: [providerEmail],
      subject,
      resendId: data?.id ?? null,
      errorMessage: error ? error.message : null,
      metadata: { providerId, clerkEmail },
    })

    return ok({ success: !error })
  } catch (err) {
    return errorResponse(err)
  }
}
