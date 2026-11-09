import { errorResponse, ok, unauthorized } from '@/lib/api'
import { verifySignedWebhook } from '@/lib/webhooks'

export const maxDuration = 30
export const runtime = 'nodejs'

type Params = Promise<{ event: string }>

/**
 * POST /api/webhooks/make/[event] — inbound Make.com / partner webhook
 * receiver (M2 #9 / #10).
 *
 * Signature scheme:
 *   - `x-listd-timestamp`  — unix seconds, must be within ±5 min of now
 *   - `x-listd-signature`  — hex HMAC-SHA256 of `<timestamp>.<rawBody>` keyed
 *                            on `MAKE_WEBHOOK_SECRET`
 *
 * Configure Make.com's "Custom webhook" with these two headers in the
 * "Output" tab. The secret lives in `MAKE_WEBHOOK_SECRET` (Vercel env).
 *
 * Path-segment `event` is opaque routing — partners send to e.g.
 * `/api/webhooks/make/job-published`, `/api/webhooks/make/contact-updated`.
 * Validate it inside the route or 404 unknown events.
 *
 * **Currently a scaffold.** No event handlers are wired yet — this lands the
 * signature + replay-window enforcement so concrete event handlers can be
 * added without re-doing the auth boundary.
 */
export async function POST(req: Request, { params }: { params: Params }) {
  const { event } = await params
  try {
    const rawBody = await req.text()
    const verdict = verifySignedWebhook(
      rawBody,
      req.headers.get('x-listd-timestamp'),
      req.headers.get('x-listd-signature'),
      process.env.MAKE_WEBHOOK_SECRET
    )

    if (!verdict.ok) {
      console.warn(
        `[webhooks/make] rejected ${event}: ${verdict.reason}`
      )
      return unauthorized()
    }

    // No event handlers wired yet — log and accept so partners can integrate
    // against the auth boundary now and we add the dispatcher later.
    console.log(
      `[webhooks/make] accepted event=${event} bytes=${rawBody.length}`
    )

    return ok({ accepted: true, event })
  } catch (err) {
    console.error('[webhooks/make] error:', err)
    return errorResponse(err)
  }
}
