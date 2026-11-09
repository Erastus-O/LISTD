import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { errorResponse, notFound, ok } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import { promoCodes, withServiceRole } from '@/db'
import { callerIp, callerUserAgent, logAuditEvent } from '@/lib/audit'

export const runtime = 'nodejs'

const PatchSchema = z
  .object({
    enabled: z.boolean(),
    percentOff: z.number().int().min(1).max(100).nullable(),
    serviceTypes: z.array(z.string().min(1).max(60)).max(50).nullable(),
    startsAt: z.string().datetime().nullable(),
    expiresAt: z.string().datetime().nullable(),
    maxRedemptions: z.number().int().min(1).max(100000).nullable(),
    /** 0036 — set/replace the private-code assignment; null or [] makes
     *  the code public again. */
    assignedClientIds: z.array(z.string().uuid()).max(500).nullable(),
    notes: z.string().trim().max(500).nullable(),
  })
  .partial()

/**
 * PATCH /api/admin/promos/[promoId] — lifecycle management (admin only):
 * enable/disable, adjust the validity window, cap, percentage, scope, notes.
 * The code string and kind are immutable — retire a code and create a new
 * one instead of mutating what past redemptions meant.
 */
export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ promoId: string }> }
) {
  const session = await authorizeRequest('admin')
  if (session instanceof Response) return session

  try {
    const { promoId } = await ctx.params
    const body = PatchSchema.parse(await req.json())
    if (Object.keys(body).length === 0) {
      return Response.json({ error: 'Nothing to update.' }, { status: 400 })
    }

    // Empty assignment list = public code; store NULL for consistency.
    if (body.assignedClientIds && body.assignedClientIds.length === 0) {
      body.assignedClientIds = null
    }

    const row = await withServiceRole(async (tx) => {
      const [updated] = await tx
        .update(promoCodes)
        .set({ ...body, updatedAt: new Date().toISOString() })
        .where(eq(promoCodes.id, promoId))
        .returning()
      if (updated) {
        await logAuditEvent(tx, {
          category: 'billing',
          action: 'promo.updated',
          actorUserId: session.userId,
          targetType: 'promo_code',
          targetId: updated.id,
          payload: { code: updated.code, changes: body },
          ipAddress: callerIp(req),
          userAgent: callerUserAgent(req),
        })
      }
      return updated
    })

    if (!row) return notFound('Promo code not found')
    return ok({ promo: row })
  } catch (err) {
    return errorResponse(err)
  }
}

/**
 * DELETE /api/admin/promos/[promoId] — hard-delete an UNUSED code (admin
 * only). Codes with redemptions carry pricing history on jobs — disable
 * those instead.
 */
export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ promoId: string }> }
) {
  const session = await authorizeRequest('admin')
  if (session instanceof Response) return session

  try {
    const { promoId } = await ctx.params
    const result = await withServiceRole(async (tx) => {
      const [existing] = await tx
        .select({
          id: promoCodes.id,
          code: promoCodes.code,
          redemptionCount: promoCodes.redemptionCount,
        })
        .from(promoCodes)
        .where(eq(promoCodes.id, promoId))
        .limit(1)
      if (!existing) return { status: 'not_found' as const }
      if (existing.redemptionCount > 0) {
        return { status: 'in_use' as const }
      }
      await tx.delete(promoCodes).where(eq(promoCodes.id, promoId))
      await logAuditEvent(tx, {
        category: 'billing',
        action: 'promo.deleted',
        actorUserId: session.userId,
        targetType: 'promo_code',
        targetId: promoId,
        payload: { code: existing.code },
        ipAddress: callerIp(req),
        userAgent: callerUserAgent(req),
      })
      return { status: 'deleted' as const }
    })

    if (result.status === 'not_found') return notFound('Promo code not found')
    if (result.status === 'in_use') {
      return Response.json(
        {
          error:
            'This code has been redeemed on jobs — disable it instead of deleting.',
        },
        { status: 409 }
      )
    }
    return ok({ deleted: true })
  } catch (err) {
    return errorResponse(err)
  }
}
