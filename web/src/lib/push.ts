import 'server-only'
import { eq, sql } from 'drizzle-orm'
import webpush, { type PushSubscription, type WebPushError } from 'web-push'
import { pushSubscriptions, withServiceRole } from '@/db'

/**
 * Web Push fan-out helper. The cron + any future ad-hoc push site calls
 * `sendPushToUser(userId, payload)`; this module handles the VAPID setup,
 * the per-endpoint send loop, and the gone-or-broken-subscription cleanup.
 *
 * VAPID setup happens once on first call. If env vars are missing, every
 * call no-ops and logs once — same graceful-degrade pattern as the cache
 * and rate-limit helpers. Missing keys never throw; the cron just doesn't
 * push.
 *
 * Pruning policy: a `410 Gone` from the push provider means the
 * subscription is permanently dead (user revoked, browser uninstalled).
 * We delete those rows immediately. A `404` is rarer but the same signal
 * in practice. Anything else (5xx, timeouts) stamps `last_error` and
 * keeps the row — transient infra problems shouldn't lose us a working
 * subscription.
 */

const PUSH_TTL_SECONDS = 60 * 60 * 24 // Keep the message queued at the
// push provider for at most 24h. After that, drop it — a "you have a job
// in 2 hours" notification two days late is misinformation. Push providers
// honour this as a hint, not a guarantee.

let _configured = false
let _disabled = false
let _warnedOnce = false

function ensureVapidConfigured(): boolean {
  if (_disabled) return false
  if (_configured) return true
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const priv = process.env.VAPID_PRIVATE_KEY
  const contact = process.env.VAPID_CONTACT_EMAIL ?? 'mailto:tech@listd.co.uk'
  if (!pub || !priv) {
    if (!_warnedOnce) {
      console.info(
        '[push] disabled : NEXT_PUBLIC_VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY not set; sends will no-op'
      )
      _warnedOnce = true
    }
    _disabled = true
    return false
  }
  webpush.setVapidDetails(contact, pub, priv)
  _configured = true
  return true
}

export type PushPayload = {
  title: string
  body: string
  /** Optional in-app deep link the SW navigates to on click. */
  url?: string
  /** Optional tag — groups notifications so a follow-up replaces the prior one. */
  tag?: string
  /** Material icon name shown in the notification (mobile SW renders it). */
  icon?: string
}

type SendResult = {
  attempted: number
  delivered: number
  pruned: number
  failed: number
}

/**
 * Fan out a push to every subscription a user has registered.
 *
 * Returns the per-call counts so callers can record them in audit /
 * idempotency rows. Never throws — every send failure is captured.
 */
export async function sendPushToUser(
  userId: string,
  payload: PushPayload
): Promise<SendResult> {
  const result: SendResult = { attempted: 0, delivered: 0, pruned: 0, failed: 0 }
  if (!ensureVapidConfigured()) return result

  const rows = await withServiceRole(async (tx) =>
    tx
      .select({
        id: pushSubscriptions.id,
        endpoint: pushSubscriptions.endpoint,
        p256dh: pushSubscriptions.p256dh,
        auth: pushSubscriptions.auth,
      })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, userId))
  )
  if (rows.length === 0) return result

  const json = JSON.stringify(payload)

  for (const row of rows) {
    result.attempted += 1
    const sub: PushSubscription = {
      endpoint: row.endpoint,
      keys: { p256dh: row.p256dh, auth: row.auth },
    }
    try {
      await webpush.sendNotification(sub, json, { TTL: PUSH_TTL_SECONDS })
      result.delivered += 1
      // Best-effort write — don't fail the whole loop if this fails.
      await withServiceRole(async (tx) =>
        tx
          .update(pushSubscriptions)
          .set({ lastUsedAt: sql`now()`, lastError: null, lastErrorAt: null })
          .where(eq(pushSubscriptions.id, row.id))
      ).catch(() => {})
    } catch (err) {
      const e = err as WebPushError
      // 404/410 = subscription is permanently dead. Prune it so we stop
      // wasting cycles on a corpse.
      if (e?.statusCode === 404 || e?.statusCode === 410) {
        await withServiceRole(async (tx) =>
          tx.delete(pushSubscriptions).where(eq(pushSubscriptions.id, row.id))
        ).catch(() => {})
        result.pruned += 1
      } else {
        const msg = e?.body ?? (err instanceof Error ? err.message : String(err))
        await withServiceRole(async (tx) =>
          tx
            .update(pushSubscriptions)
            .set({
              lastError: typeof msg === 'string' ? msg.slice(0, 500) : 'unknown',
              lastErrorAt: sql`now()`,
            })
            .where(eq(pushSubscriptions.id, row.id))
        ).catch(() => {})
        result.failed += 1
      }
    }
  }

  return result
}
