import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { errorResponse, ok } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import { notificationPreferences, withServiceRole } from '@/db'
import { bustUserNotificationPrefs } from '@/lib/notify-prefs'

export const maxDuration = 10
export const runtime = 'nodejs'

/**
 * Whitelist of toggle keys writable from the prefs UI. All boolean. Mirrors
 * `notification_preferences` in [schema.ts](../../../../db/schema/schema.ts).
 *
 * Email defaults: ON for transactional, OFF for marketing.
 * SMS defaults OFF (explicit opt-in required for UK compliance) and is
 * live — wired to appointment reminders, clerk-accepted, report-ready,
 * job-cancelled (smsJobUpdates) and payment-received (smsPaymentUpdates)
 * via Twilio. WhatsApp remains a Phase-2 stub.
 */
const PrefBool = z.boolean().optional()

const RequestSchema = z
  .object({
    emailJobUpdates: PrefBool,
    emailPaymentUpdates: PrefBool,
    emailReportDelivery: PrefBool,
    emailNewMessages: PrefBool,
    emailMarketing: PrefBool,
    inappJobUpdates: PrefBool,
    inappPaymentUpdates: PrefBool,
    inappReportDelivery: PrefBool,
    inappNewMessages: PrefBool,
    // M1 #16 additions
    smsJobUpdates: PrefBool,
    smsPaymentUpdates: PrefBool,
    whatsappOptIn: PrefBool,
    emailMidtermReminder: PrefBool,
    emailCheckoutReminder: PrefBool,
    emailNextServicePrompt: PrefBool,
  })
  .strict()

/**
 * GET /api/notification-preferences — return the caller's current preferences.
 * Returns the row defaults when no row exists yet (first-time read).
 */
export async function GET() {
  const session = await authorizeRequest()
  if (session instanceof Response) return session

  try {
    const [row] = await withServiceRole(async (tx) =>
      tx
        .select()
        .from(notificationPreferences)
        .where(eq(notificationPreferences.userId, session.userId))
        .limit(1)
    )
    return ok({ preferences: row ?? null })
  } catch (err) {
    return errorResponse(err)
  }
}

/**
 * PATCH /api/notification-preferences — partial update / upsert.
 *
 * If the user has no row yet, we INSERT with table defaults overlaid by the
 * patch payload. Otherwise UPDATE in place. Either way the response is the
 * canonical post-state row.
 */
export async function PATCH(req: Request) {
  const session = await authorizeRequest()
  if (session instanceof Response) return session

  try {
    const body = RequestSchema.parse(await req.json())
    const updates = Object.fromEntries(
      Object.entries(body).filter(([, v]) => v !== undefined)
    ) as Record<string, boolean>

    const result = await withServiceRole(async (tx) => {
      // Upsert keyed on user_id (no unique index — emulate via SELECT + branch).
      const [existing] = await tx
        .select({ id: notificationPreferences.id })
        .from(notificationPreferences)
        .where(eq(notificationPreferences.userId, session.userId))
        .limit(1)

      if (existing) {
        const [updated] = await tx
          .update(notificationPreferences)
          .set(updates)
          .where(eq(notificationPreferences.userId, session.userId))
          .returning()
        return updated
      }
      const [inserted] = await tx
        .insert(notificationPreferences)
        .values({ userId: session.userId, ...updates })
        .returning()
      return inserted
    })

    await bustUserNotificationPrefs(session.userId)
    return ok({ preferences: result })
  } catch (err) {
    return errorResponse(err)
  }
}
