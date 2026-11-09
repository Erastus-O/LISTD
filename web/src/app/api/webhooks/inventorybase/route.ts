import { errorResponse, ok, unauthorized } from '@/lib/api'
import { verifySignedWebhook } from '@/lib/webhooks'

export const maxDuration = 30
export const runtime = 'nodejs'

/**
 * POST /api/webhooks/inventorybase — inbound InventoryBase webhook receiver
 * (M2 #7 / R7 mitigation).
 *
 * Signature scheme:
 *   - `x-listd-timestamp`  — unix seconds, must be within ±5 min of now
 *   - `x-listd-signature`  — hex HMAC-SHA256 of `<timestamp>.<rawBody>`
 *                            keyed on `INVENTORYBASE_WEBHOOK_SECRET`
 *
 * **State of play:** InventoryBase does not currently push webhooks; the
 * primary integration is the iCal pull at
 * [/api/integrations/inventorybase/sync](../../integrations/inventorybase/sync/route.ts)
 * plus the [drift cron](../../cron/inventorybase-drift/route.ts) we shipped
 * under M2 #8. This handler is the **scaffold for when IB exposes push** —
 * the auth boundary is wired now so concrete event dispatchers (booking
 * created, booking moved, agency-side cancellation) can land without
 * re-doing the HMAC + replay-window enforcement.
 *
 * Why same scheme as `/api/webhooks/make/[event]`: IB currently has no
 * documented webhook signing scheme of its own, so we standardise on the
 * Stripe-style HMAC-of-`<ts>.<body>` we already use for Make.com. If IB
 * later ships a Svix-style or proprietary signature, swap in a
 * `verifyInventorybaseWebhook` helper alongside the existing ones.
 */
export async function POST(req: Request) {
  try {
    const rawBody = await req.text()
    const verdict = verifySignedWebhook(
      rawBody,
      req.headers.get('x-listd-timestamp'),
      req.headers.get('x-listd-signature'),
      process.env.INVENTORYBASE_WEBHOOK_SECRET
    )

    if (!verdict.ok) {
      console.warn(
        `[webhooks/inventorybase] rejected: ${verdict.reason}`
      )
      return unauthorized()
    }

    // No event dispatcher wired yet — IB doesn't push events today. When it
    // does, branch on a payload-level event-type field (or a path-segment
    // route variant) and run the appropriate handler inside a service-role
    // transaction.
    console.log(
      `[webhooks/inventorybase] accepted bytes=${rawBody.length}`
    )

    return ok({ accepted: true })
  } catch (err) {
    console.error('[webhooks/inventorybase] error:', err)
    return errorResponse(err)
  }
}
