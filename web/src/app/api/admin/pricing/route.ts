import { sql } from 'drizzle-orm'
import { errorResponse, ok } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import { platformSettings, withServiceRole } from '@/db'
import { callerIp, callerUserAgent, logAuditEvent } from '@/lib/audit'
import {
  PRICING_SETTINGS_KEY,
  PricingMatricesSchema,
  bustEffectivePricing,
} from '@/lib/pricing-settings'

export const maxDuration = 15
export const runtime = 'nodejs'

/**
 * PUT /api/admin/pricing — replace the runtime rate card.
 *
 * Body is a complete {@link PricingMatricesSchema} document (every cell, 10
 * sizes each). Stored as JSON in `platform_settings[pricing_matrices]`, with a
 * `platform_setting / pricing.updated` audit row carrying the full new matrices
 * for the change trail. The cached effective pricing is busted so the booking
 * flow + `jobs/create` pick it up immediately. Admin only.
 */
export async function PUT(req: Request) {
  const session = await authorizeRequest('admin')
  if (session instanceof Response) return session

  try {
    const matrices = PricingMatricesSchema.parse(await req.json())
    const value = JSON.stringify(matrices)
    const ip = callerIp(req)
    const ua = callerUserAgent(req)

    await withServiceRole(async (tx) => {
      await tx
        .insert(platformSettings)
        .values({
          key: PRICING_SETTINGS_KEY,
          value,
          updatedBy: session.userId,
          updatedAt: sql`now()`,
        })
        .onConflictDoUpdate({
          target: platformSettings.key,
          set: { value, updatedBy: session.userId, updatedAt: sql`now()` },
        })

      await logAuditEvent(tx, {
        category: 'platform_setting',
        action: 'pricing.updated',
        actorUserId: session.userId,
        targetType: 'platform_setting',
        targetId: PRICING_SETTINGS_KEY,
        payload: { matrices },
        ipAddress: ip,
        userAgent: ua,
      })
    })

    await bustEffectivePricing()

    return ok({ success: true })
  } catch (err) {
    console.error('[admin/pricing] error:', err)
    return errorResponse(err)
  }
}
