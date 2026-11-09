import { eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { errorResponse, escapeHtml, notFound, ok } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import { profiles, notifications, withServiceRole } from '@/db'
import { callerIp, callerUserAgent, logAuditEvent } from '@/lib/audit'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import {
  FROM_TRANSACTIONAL,
  REPLY_TO_DEFAULT,
  getResend,
  logEmail,
} from '@/lib/resend'

export const maxDuration = 30
export const runtime = 'nodejs'

const RequestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('approve') }),
  z.object({
    action: z.literal('reject'),
    reason: z.string().trim().min(1).max(2000),
  }),
])

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://listd.co.uk'
const FUNCTION_NAME = 'admin-clerk-verification'

type Params = Promise<{ clerkId: string }>

/**
 * POST /api/admin/clerks/[clerkId]/verification — approve or reject a clerk's
 * verification submission (M1 #7).
 *
 * On approve: status → `verified`, marketplace gate opens, clerk gets a
 * "you're approved" email.
 * On reject:  status → `rejected`, rejection reason persisted, clerk gets an
 * "we need more info" email; they can resubmit at /onboarding/clerk.
 */
export async function POST(req: Request, { params }: { params: Params }) {
  const session = await authorizeRequest('admin')
  if (session instanceof Response) return session

  try {
    const { clerkId } = await params
    const parsed = RequestSchema.parse(await req.json())

    const supabaseAdmin = getSupabaseAdmin()
    const ip = callerIp(req)
    const ua = callerUserAgent(req)

    const updated = await withServiceRole(async (tx) => {
      const [clerk] = await tx
        .select({
          fullName: profiles.fullName,
          verificationStatus: profiles.verificationStatus,
        })
        .from(profiles)
        .where(eq(profiles.userId, clerkId))
        .limit(1)
      if (!clerk) return null

      if (parsed.action === 'approve') {
        await tx
          .update(profiles)
          .set({
            verificationStatus: 'verified',
            verificationReviewedAt: sql`now()`,
            verificationReviewedBy: session.userId,
            verificationRejectionReason: null,
          })
          .where(eq(profiles.userId, clerkId))
      } else {
        await tx
          .update(profiles)
          .set({
            verificationStatus: 'rejected',
            verificationReviewedAt: sql`now()`,
            verificationReviewedBy: session.userId,
            verificationRejectionReason: parsed.reason,
          })
          .where(eq(profiles.userId, clerkId))
      }

      // In-app notification to the clerk.
      await tx.insert(notifications).values({
        userId: clerkId,
        type: 'verification_decision',
        title:
          parsed.action === 'approve'
            ? 'You are verified'
            : 'Verification needs changes',
        message:
          parsed.action === 'approve'
            ? 'Your account is verified. You can now accept jobs in your coverage area.'
            : `We need a few changes before we can approve you: ${parsed.reason}`,
        link:
          parsed.action === 'approve'
            ? '/clerk/jobs/available'
            : '/onboarding/clerk',
      })

      // Audit row inside the same tx — never end up with a state change but
      // no log row. Closes M1 #22 F3 (verification re-decision history).
      await logAuditEvent(tx, {
        category: 'verification',
        action: parsed.action === 'approve' ? 'verification.approved' : 'verification.rejected',
        actorUserId: session.userId,
        targetType: 'profile',
        targetId: clerkId,
        payload:
          parsed.action === 'reject'
            ? { reason: parsed.reason, priorStatus: clerk.verificationStatus ?? null }
            : { priorStatus: clerk.verificationStatus ?? null },
        ipAddress: ip,
        userAgent: ua,
      })

      return clerk
    })

    if (!updated) return notFound('Clerk not found')

    // Resolve the clerk's email via the auth admin API.
    const {
      data: { user: clerkUser },
      error: userError,
    } = await supabaseAdmin.auth.admin.getUserById(clerkId)
    if (userError || !clerkUser?.email) {
      // The DB update already succeeded; surface a soft 200 with a warning.
      console.warn(
        '[admin/clerks/verification] decision saved but no email for clerkId',
        clerkId,
        userError
      )
      return ok({ success: true, emailSent: false })
    }

    const recipient = clerkUser.email
    const safeName = escapeHtml(updated.fullName ?? 'there')
    const safeReason =
      parsed.action === 'reject' ? escapeHtml(parsed.reason) : ''

    const subject =
      parsed.action === 'approve'
        ? 'You are verified on LISTD Pro'
        : 'A few changes needed for your LISTD Pro application'

    const html =
      parsed.action === 'approve'
        ? renderApprovalEmail(safeName)
        : renderRejectionEmail(safeName, safeReason)

    let resendId: string | null = null
    let errorMessage: string | null = null
    try {
      const r = await getResend().emails.send({
        from: FROM_TRANSACTIONAL,
        to: recipient,
        replyTo: REPLY_TO_DEFAULT,
        subject,
        html,
      })
      if (r.error) {
        errorMessage = r.error.message
      } else {
        resendId = r.data?.id ?? null
      }
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'Unknown error'
    }

    await logEmail({
      functionName: FUNCTION_NAME,
      recipientEmails: [recipient],
      subject,
      resendId,
      errorMessage,
      metadata: { clerkId, action: parsed.action },
    })

    if (errorMessage) {
      console.error('[admin/clerks/verification] email send failed:', errorMessage)
    }

    return ok({ success: true, emailSent: !errorMessage })
  } catch (err) {
    console.error('[admin/clerks/verification] error:', err)
    return errorResponse(err)
  }
}

function renderApprovalEmail(safeName: string): string {
  const ctaUrl = `${SITE_URL}/clerk/jobs/available`
  return `
    <!DOCTYPE html>
    <html><head><meta charset="utf-8"></head>
    <body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;margin:0;padding:0;background:#f4f4f5;">
      <div style="max-width:600px;margin:0 auto;padding:20px;">
        <div style="background:#fff;border-radius:12px;padding:32px;box-shadow:0 1px 3px rgba(0,0,0,.1);">
          <h1 style="color:#18181b;font-size:22px;margin:0 0 12px;">You're verified ✅</h1>
          <p style="color:#3f3f46;font-size:15px;margin:0 0 16px;">Hi ${safeName},</p>
          <p style="color:#3f3f46;font-size:15px;margin:0 0 16px;">Your documents have been reviewed and approved. You can now see and accept jobs in your coverage area.</p>
          <div style="text-align:center;margin:28px 0;">
            <a href="${ctaUrl}" style="display:inline-block;background:#0d9488;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;font-size:14px;">View available jobs</a>
          </div>
          <p style="color:#71717a;font-size:13px;margin:0;">Need help? Reply to this email and our team will get back to you.</p>
        </div>
      </div>
    </body></html>`
}

function renderRejectionEmail(safeName: string, safeReason: string): string {
  const ctaUrl = `${SITE_URL}/onboarding/clerk`
  return `
    <!DOCTYPE html>
    <html><head><meta charset="utf-8"></head>
    <body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;margin:0;padding:0;background:#f4f4f5;">
      <div style="max-width:600px;margin:0 auto;padding:20px;">
        <div style="background:#fff;border-radius:12px;padding:32px;box-shadow:0 1px 3px rgba(0,0,0,.1);">
          <h1 style="color:#18181b;font-size:22px;margin:0 0 12px;">A few changes needed</h1>
          <p style="color:#3f3f46;font-size:15px;margin:0 0 16px;">Hi ${safeName},</p>
          <p style="color:#3f3f46;font-size:15px;margin:0 0 16px;">Thanks for applying to LISTD Pro. We've reviewed your submission and need a few changes before we can verify you:</p>
          <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:16px;margin:0 0 20px;color:#991b1b;font-size:14px;line-height:1.6;">${safeReason}</div>
          <div style="text-align:center;margin:24px 0;">
            <a href="${ctaUrl}" style="display:inline-block;background:#0d9488;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;font-size:14px;">Update my application</a>
          </div>
          <p style="color:#71717a;font-size:13px;margin:0;">Questions? Reply to this email and we'll help.</p>
        </div>
      </div>
    </body></html>`
}
