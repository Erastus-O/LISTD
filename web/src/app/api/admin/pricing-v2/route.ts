import { z } from 'zod'
import { errorResponse, ok } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import { withServiceRole } from '@/db'
import { logAuditEvent } from '@/lib/audit'
import { DEFAULT_PRICING } from '@/lib/listd/pricing'
import { getPricing, savePricingOverrides } from '@/lib/listd/pricing-settings'

export const runtime = 'nodejs'

// Only known top-level sections can be overridden.
const Body = z.object(
  Object.fromEntries(Object.keys(DEFAULT_PRICING).map((k) => [k, z.unknown().optional()]))
).strict()

/** GET: the effective rate card. POST: save overrides (merged over the defaults). */
export async function GET() {
  const session = await authorizeRequest('admin')
  if (session instanceof Response) return session
  return ok(await getPricing())
}

export async function POST(req: Request) {
  const session = await authorizeRequest('admin')
  if (session instanceof Response) return session
  try {
    const overrides = Body.parse(await req.json())
    await savePricingOverrides(overrides)
    await withServiceRole((tx) =>
      logAuditEvent(tx, {
        category: 'pricing_override',
        action: 'pricing.rate_card_updated',
        actorUserId: session.userId,
        targetType: 'platform_setting',
        targetId: 'pricing_v2',
        payload: { sections: Object.keys(overrides) },
      })
    )
    return ok({ success: true })
  } catch (err) {
    console.error('[admin/pricing-v2] error:', err)
    return errorResponse(err)
  }
}
