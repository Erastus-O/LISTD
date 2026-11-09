import 'server-only'
import { eq } from 'drizzle-orm'
import { db, notificationPreferences, profiles, type Tx } from '@/db'
import { bust, cacheKey, getOrSet } from '@/lib/cache'
import { logSmsSkipped, sendSms } from '@/lib/sms'

/**
 * Single source of truth for "should we send X to user Y?".
 *
 * Used by every `/api/notifications/*` handler and the cron jobs to honour
 * user-set preferences (M1 #16 toggles).
 *
 * Defaults match the `notification_preferences` schema — most channels are
 * ON by default; SMS / WhatsApp / marketing default OFF.
 *
 * Caching: notification fan-out reads 1-3 prefs per recipient per event;
 * batched broadcasts read thousands. The per-user prefs blob is cached
 * for 5 minutes and busted from the PATCH route, so a fan-out of N
 * recipients makes ~N cache reads instead of N DB hits.
 */

const PREFS_CACHE_TTL_SECONDS = 5 * 60

function prefsCacheKey(userId: string): string {
  return cacheKey('prefs', 'notif', userId)
}

export type NotificationPrefKey = keyof Omit<
  typeof notificationPreferences.$inferSelect,
  'id' | 'userId' | 'createdAt' | 'updatedAt'
>

/**
 * Defaults applied when a user has no `notification_preferences` row yet.
 * Mirrors the column defaults in the schema — keep in lockstep.
 */
const DEFAULTS: Record<NotificationPrefKey, boolean> = {
  emailJobUpdates: true,
  emailPaymentUpdates: true,
  emailReportDelivery: true,
  emailNewMessages: true,
  emailMarketing: false,
  inappJobUpdates: true,
  inappPaymentUpdates: true,
  inappReportDelivery: true,
  inappNewMessages: true,
  smsJobUpdates: false,
  smsPaymentUpdates: false,
  whatsappOptIn: false,
  emailMidtermReminder: true,
  emailCheckoutReminder: true,
  emailNextServicePrompt: true,
}

/**
 * Load every toggle for a user as a single blob. Returns the schema
 * defaults if no row exists yet. Cached for 5 minutes; busted by
 * `bustUserNotificationPrefs` from the PATCH route.
 *
 * Uses the pooled `db` connection rather than the caller's tx because
 * preferences are read-mostly per-user data with no transactional
 * coupling to the notification being created. Reading from cache
 * (which doesn't honour an in-flight tx) is therefore safe — the only
 * way the cache could be "wrong" is if the caller updated their own
 * prefs in the same tx and then read them back, which no notification
 * handler does.
 */
export async function loadUserNotificationPrefs(
  userId: string
): Promise<Record<NotificationPrefKey, boolean>> {
  return getOrSet(prefsCacheKey(userId), PREFS_CACHE_TTL_SECONDS, async () => {
    const [row] = await db
      .select()
      .from(notificationPreferences)
      .where(eq(notificationPreferences.userId, userId))
      .limit(1)
    if (!row) return DEFAULTS
    // Build the blob from the schema defaults overlaid with any
    // explicitly-set values from the row. Falls through to DEFAULTS for
    // any column the user hasn't touched.
    const result: Record<string, boolean> = { ...DEFAULTS }
    for (const key of Object.keys(DEFAULTS) as NotificationPrefKey[]) {
      const value = row[key]
      if (typeof value === 'boolean') result[key] = value
    }
    return result as Record<NotificationPrefKey, boolean>
  })
}

/**
 * Bust the cached preference blob for a user. Call from the PATCH route
 * after the row is updated so the next notification fan-out reads the
 * fresh values instead of waiting out the 5-minute TTL.
 */
export async function bustUserNotificationPrefs(userId: string): Promise<void> {
  return bust(prefsCacheKey(userId))
}

/**
 * Read a single preference for a user. Returns the schema default if no row
 * exists. The `tx` parameter is kept for backwards compatibility with the
 * pre-cache callers but is ignored — reads go through the cached blob.
 */
export async function shouldNotify(
  _tx: Tx,
  userId: string,
  key: NotificationPrefKey
): Promise<boolean> {
  const prefs = await loadUserNotificationPrefs(userId)
  return prefs[key]
}

/**
 * Send an SMS, gated by the user's `smsJobUpdates` / `smsPaymentUpdates`
 * preference. Resolves the user's phone from `profiles.phone` and
 * dispatches via Twilio.
 *
 * The `tx` parameter is vestigial (kept for back-compat with the
 * stub-era signature); reads now use the pooled `db` connection so the
 * caller's transaction isolation doesn't trap a slow Twilio call.
 *
 * Returns a `{ skipped, reason? }` shape so existing callers don't
 * have to relearn the contract. New callers may prefer the more
 * detailed result from {@link sendSms} directly.
 */
export async function sendSmsStub(
  _tx: Tx,
  userId: string,
  prefKey: 'smsJobUpdates' | 'smsPaymentUpdates',
  message: string
): Promise<{ skipped: boolean; reason?: string }> {
  return notifyUserSms(userId, prefKey, message)
}

/**
 * Transaction-free SMS dispatch, gated by the user's
 * `smsJobUpdates` / `smsPaymentUpdates` preference. Use this from a
 * request handler AFTER the DB transaction has committed, so a slow
 * Twilio call never holds a Postgres connection open. (Reads use the
 * pooled `db` connection, and `sendSms` logs on its own connection, so
 * no caller transaction is needed.)
 *
 * Same `{ skipped, reason? }` contract as {@link sendSmsStub}. Safe to
 * fan out with `Promise.allSettled` — a single recipient's failure
 * (no phone / opted out / Twilio error) never throws.
 */
export async function notifyUserSms(
  userId: string,
  prefKey: 'smsJobUpdates' | 'smsPaymentUpdates',
  message: string
): Promise<{ skipped: boolean; reason?: string }> {
  const allowed = await loadUserNotificationPrefs(userId).then(
    (p) => p[prefKey]
  )
  if (!allowed) {
    await logSmsSkipped({
      functionName: `notify-prefs:${prefKey}`,
      recipientUserId: userId,
      recipientPhone: null,
      body: message,
      reason: 'opt_out',
    })
    return { skipped: true, reason: 'pref_off' }
  }

  const [row] = await db
    .select({ phone: profiles.phone })
    .from(profiles)
    .where(eq(profiles.userId, userId))
    .limit(1)
  if (!row?.phone) {
    await logSmsSkipped({
      functionName: `notify-prefs:${prefKey}`,
      recipientUserId: userId,
      recipientPhone: null,
      body: message,
      reason: 'no_phone',
    })
    return { skipped: true, reason: 'no_phone' }
  }

  const result = await sendSms({
    functionName: `notify-prefs:${prefKey}`,
    recipientUserId: userId,
    toPhone: row.phone,
    body: message,
    metadata: { prefKey },
  })
  if (!result.ok) {
    // 'disabled' fires when Twilio env vars aren't set — that's a
    // legitimate "skipped" outcome rather than a failure, same as the
    // graceful-degrade pattern on cache / push / rate-limit.
    return { skipped: true, reason: result.status }
  }
  return { skipped: false }
}

/**
 * Stubbed WhatsApp dispatcher. Honours `whatsappOptIn`. Same shape as
 * `sendSmsStub` — flip to a real Twilio Conversations call in Phase 2.
 */
export async function sendWhatsappStub(
  tx: Tx,
  userId: string,
  message: string
): Promise<{ skipped: boolean; reason?: string }> {
  const allowed = await shouldNotify(tx, userId, 'whatsappOptIn')
  if (!allowed) return { skipped: true, reason: 'pref_off' }
  console.log(`[whatsapp-stub] would send to ${userId}: ${message}`)
  return { skipped: false }
}
