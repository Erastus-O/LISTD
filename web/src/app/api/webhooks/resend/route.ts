import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { errorResponse, ok, unauthorized } from '@/lib/api'
import {
  emailLogs,
  notificationPreferences,
  withServiceRole,
} from '@/db'
import { verifyResendWebhook } from '@/lib/webhooks'
import { getSupabaseAdmin } from '@/lib/supabase/admin'

export const maxDuration = 30
export const runtime = 'nodejs'

/**
 * POST /api/webhooks/resend — Resend bounce / complaint receiver (M2 #13).
 *
 * Resend uses Svix to sign webhooks. Configure the webhook in the Resend
 * dashboard (Webhooks → Add Endpoint) to point at this URL and copy the
 * `whsec_…` secret into the `RESEND_WEBHOOK_SECRET` env var.
 *
 * Event handling:
 *   - `email.bounced` (hard)      → flip every `email_*` toggle to false
 *                                   for the recipient. Soft bounces are
 *                                   logged but not actioned.
 *   - `email.complained`          → same as hard bounce.
 *   - `email.delivered` / opened /
 *     clicked / sent / failed     → audit-log only.
 *
 * Idempotency: the `svix-id` header uniquely identifies the message. Resend
 * retries deliver the same id; we tolerate dupes by writing one
 * `email_logs` row per event without dedup (cheap, additive). If duplicate
 * suppression becomes a problem, key on `metadata.svixId`.
 */

const ResendEventSchema = z.object({
  type: z.string(),
  data: z
    .object({
      email_id: z.string().optional(),
      to: z.array(z.string()).or(z.string()).optional(),
      bounce: z
        .object({
          type: z.string().optional(), // 'hard' | 'soft' | 'general' | 'undetermined'
          message: z.string().optional(),
        })
        .optional(),
      subject: z.string().optional(),
    })
    .passthrough(),
})

const HARD_FAILURE_TYPES = new Set(['email.bounced', 'email.complained'])

export async function POST(req: Request) {
  try {
    const rawBody = await req.text()
    const verdict = verifyResendWebhook(
      rawBody,
      req.headers,
      process.env.RESEND_WEBHOOK_SECRET
    )

    if (!verdict.ok) {
      console.warn(`[webhooks/resend] rejected: ${verdict.reason}`)
      return unauthorized()
    }

    const event = ResendEventSchema.parse(JSON.parse(rawBody))
    const recipients = normaliseRecipients(event.data.to)
    const isHard =
      HARD_FAILURE_TYPES.has(event.type) &&
      (event.type === 'email.complained' ||
        event.data.bounce?.type === 'hard')

    let usersDisabled = 0
    if (isHard && recipients.length > 0) {
      usersDisabled = await disableEmailPrefsForRecipients(recipients)
    }

    // Audit-log every event (delivered, opened, bounced, complained, …) so
    // the M2 #12 email-log dashboard surfaces a complete picture.
    await withServiceRole(async (tx) =>
      tx.insert(emailLogs).values(
        recipients.map((recipient) => ({
          functionName: 'webhook-resend',
          recipientEmail: recipient,
          subject: event.data.subject ?? `[${event.type}]`,
          status: isHard ? 'bounced' : 'webhook',
          resendId: event.data.email_id ?? null,
          errorMessage: event.data.bounce?.message ?? null,
          metadata: {
            svixId: verdict.svixId,
            eventType: event.type,
            bounceType: event.data.bounce?.type ?? null,
            usersDisabled,
          },
        }))
      )
    )

    return ok({
      received: event.type,
      hardFailure: isHard,
      usersDisabled,
    })
  } catch (err) {
    console.error('[webhooks/resend] error:', err)
    return errorResponse(err)
  }
}

function normaliseRecipients(to: unknown): string[] {
  if (typeof to === 'string') return [to]
  if (Array.isArray(to)) return to.filter((x): x is string => typeof x === 'string')
  return []
}

/**
 * Resolve each recipient email → user_id via Supabase admin listUsers, then
 * flip every `email_*` toggle off in `notification_preferences`.
 *
 * **Scale note:** listUsers maxes at perPage=1000. For a deployment with
 * >1000 users this fails for users in subsequent pages. The fix is to thread
 * `userId` into `email_logs.metadata` at send-time (every existing
 * `logEmail` call) and look up here by recent log instead. Tracked as a
 * follow-up; deferred because bounces are rare and the user count is
 * currently small.
 */
async function disableEmailPrefsForRecipients(
  recipients: string[]
): Promise<number> {
  const admin = getSupabaseAdmin()
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000 })
  if (error) {
    console.error('[webhooks/resend] listUsers failed:', error)
    return 0
  }

  const userIdByEmail = new Map<string, string>()
  for (const u of data.users) {
    if (u.email) userIdByEmail.set(u.email.toLowerCase(), u.id)
  }

  const userIds: string[] = []
  for (const r of recipients) {
    const id = userIdByEmail.get(r.toLowerCase())
    if (id) userIds.push(id)
  }
  if (userIds.length === 0) return 0

  // Service-role bypass: webhook signature is the auth boundary; updating
  // the recipient's prefs is the entire purpose of this call.
  await withServiceRole(async (tx) => {
    for (const userId of userIds) {
      // Upsert because a fresh user might not have a row yet.
      const updates = {
        emailJobUpdates: false,
        emailPaymentUpdates: false,
        emailReportDelivery: false,
        emailNewMessages: false,
        emailMarketing: false,
        emailMidtermReminder: false,
        emailCheckoutReminder: false,
        emailNextServicePrompt: false,
      }
      const [existing] = await tx
        .select({ id: notificationPreferences.id })
        .from(notificationPreferences)
        .where(eq(notificationPreferences.userId, userId))
        .limit(1)

      if (existing) {
        await tx
          .update(notificationPreferences)
          .set(updates)
          .where(eq(notificationPreferences.userId, userId))
      } else {
        await tx
          .insert(notificationPreferences)
          .values({ userId, ...updates })
      }
    }
  })

  return userIds.length
}
