import { eq, sql } from 'drizzle-orm'
import twilio from 'twilio'
import { errorResponse, unauthorized } from '@/lib/api'
import {
  db,
  notificationPreferences,
  profiles,
  withServiceRole,
} from '@/db'
import { bustUserNotificationPrefs } from '@/lib/notify-prefs'

export const maxDuration = 15
export const runtime = 'nodejs'

/**
 * POST /api/webhooks/twilio — inbound SMS receiver.
 *
 * Configured in the Twilio Console (Messaging Service → Integration →
 * "When a message comes in" → POST to `https://listd.co.uk/api/webhooks/twilio`).
 *
 * Twilio handles the carrier-level STOP keyword automatically — once a
 * user replies STOP, the carrier refuses further sends from our number
 * to theirs, and Twilio gives us a 21610 error on subsequent attempts.
 * That gives us baseline compliance, but it leaves a UX hole: the
 * user's `notification_preferences.sms*` toggles in their account stay
 * ON, which is misleading. So this webhook listens for STOP / UNSUBSCRIBE /
 * QUIT / CANCEL replies and flips both SMS toggles to OFF for the
 * matching user, keeping our consent model honest.
 *
 * HELP / INFO replies are responded to with a one-line description
 * (also auto-handled by Twilio Messaging Services, but we no-op here
 * so the webhook doesn't 500 on those events).
 *
 * Auth: Twilio signs every request with HMAC-SHA1 over the URL +
 * sorted form params, base64-encoded in `X-Twilio-Signature`.
 * `twilio.validateRequest()` checks it against `TWILIO_WEBHOOK_AUTH_TOKEN`
 * (falls back to `TWILIO_AUTH_TOKEN` since they're the same value by
 * default).
 *
 * Response: must return TwiML or empty body. We return an empty 200
 * since Twilio's auto-responder handles the user-visible reply.
 */

const STOP_KEYWORDS = new Set([
  'STOP',
  'STOPALL',
  'UNSUBSCRIBE',
  'CANCEL',
  'END',
  'QUIT',
])

const START_KEYWORDS = new Set(['START', 'UNSTOP', 'YES'])

export async function POST(req: Request) {
  try {
    const rawBody = await req.text()
    const params = Object.fromEntries(new URLSearchParams(rawBody))
    const signature = req.headers.get('x-twilio-signature')

    const authToken =
      process.env.TWILIO_WEBHOOK_AUTH_TOKEN ?? process.env.TWILIO_AUTH_TOKEN
    if (!authToken) {
      console.warn('[webhooks/twilio] no auth token configured')
      return unauthorized()
    }
    // The signing URL is the public URL Twilio called. Use NEXT_PUBLIC_SITE_URL
    // + the route path so dev / preview / prod all sign against the same
    // canonical string Twilio uses.
    const url =
      (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://listd.co.uk') +
      '/api/webhooks/twilio'
    if (
      !signature ||
      !twilio.validateRequest(authToken, signature, url, params)
    ) {
      console.warn('[webhooks/twilio] signature verification failed')
      return unauthorized()
    }

    const fromPhone = typeof params.From === 'string' ? params.From : null
    const bodyRaw = typeof params.Body === 'string' ? params.Body : ''
    const body = bodyRaw.trim().toUpperCase()

    // No phone or no keyword we care about → ack and bail (Twilio's
    // auto-responder still sees it).
    if (!fromPhone) return twiml('')

    const isStop = STOP_KEYWORDS.has(body)
    const isStart = START_KEYWORDS.has(body)
    if (!isStop && !isStart) {
      console.info(
        `[webhooks/twilio] non-keyword inbound: from=${fromPhone} body=${bodyRaw.slice(0, 80)}`
      )
      return twiml('')
    }

    // Match the inbound phone against `profiles.phone`. Twilio gives us
    // E.164 (+447700...); profiles.phone may be in any normalised form,
    // so we match on the digits-only suffix too as a safety net.
    const digits = fromPhone.replace(/\D/g, '')
    const candidates = await db
      .select({ userId: profiles.userId, phone: profiles.phone })
      .from(profiles)
      .where(sql`${profiles.phone} IS NOT NULL`)
    const match = candidates.find((c) => {
      if (!c.phone) return false
      const cleaned = c.phone.replace(/\D/g, '')
      return cleaned === digits || digits.endsWith(cleaned.slice(-10))
    })

    if (!match) {
      // No profile matches — log and ack. The carrier-level STOP still
      // applies; we just can't reflect it in our preference toggles.
      console.info(
        `[webhooks/twilio] no profile matches inbound phone ${fromPhone}`
      )
      return twiml('')
    }

    if (isStop) {
      await withServiceRole(async (tx) => {
        // Upsert OFF — covers both "user has a row" and "user never set
        // a preference" cases. Drizzle's onConflictDoUpdate needs a
        // unique index on user_id; the table lacks one, so we do the
        // SELECT + branch the same way the prefs PATCH route does.
        const [existing] = await tx
          .select({ id: notificationPreferences.id })
          .from(notificationPreferences)
          .where(eq(notificationPreferences.userId, match.userId))
          .limit(1)
        if (existing) {
          await tx
            .update(notificationPreferences)
            .set({
              smsJobUpdates: false,
              smsPaymentUpdates: false,
            })
            .where(eq(notificationPreferences.userId, match.userId))
        } else {
          await tx.insert(notificationPreferences).values({
            userId: match.userId,
            smsJobUpdates: false,
            smsPaymentUpdates: false,
          })
        }
      })
      await bustUserNotificationPrefs(match.userId)
      console.info(
        `[webhooks/twilio] STOP from ${fromPhone} → flipped SMS prefs OFF for ${match.userId}`
      )
    } else if (isStart) {
      // User explicitly opted back in. Note this re-enables both job
      // and payment categories — the granularity isn't recoverable
      // from a START SMS alone. If they want finer control they can
      // visit the account/notifications page.
      await withServiceRole(async (tx) => {
        const [existing] = await tx
          .select({ id: notificationPreferences.id })
          .from(notificationPreferences)
          .where(eq(notificationPreferences.userId, match.userId))
          .limit(1)
        if (existing) {
          await tx
            .update(notificationPreferences)
            .set({
              smsJobUpdates: true,
              smsPaymentUpdates: true,
            })
            .where(eq(notificationPreferences.userId, match.userId))
        } else {
          await tx.insert(notificationPreferences).values({
            userId: match.userId,
            smsJobUpdates: true,
            smsPaymentUpdates: true,
          })
        }
      })
      await bustUserNotificationPrefs(match.userId)
      console.info(
        `[webhooks/twilio] START from ${fromPhone} → flipped SMS prefs ON for ${match.userId}`
      )
    }

    return twiml('')
  } catch (err) {
    console.error('[webhooks/twilio] error:', err)
    return errorResponse(err)
  }
}

/** Empty TwiML response. Twilio accepts a bare `<Response/>` or empty
 *  body; either acks the message without sending an auto-reply (which
 *  the Messaging Service auto-responder handles separately). */
function twiml(body: string): Response {
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`, {
    status: 200,
    headers: { 'content-type': 'text/xml; charset=utf-8' },
  })
}
