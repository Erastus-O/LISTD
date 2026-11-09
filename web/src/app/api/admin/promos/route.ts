import { desc } from 'drizzle-orm'
import { z } from 'zod'
import { created, errorResponse, ok } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import { promoCodes, withServiceRole } from '@/db'
import { callerIp, callerUserAgent, logAuditEvent } from '@/lib/audit'
import { normalizePromoCode } from '@/lib/promo'

export const runtime = 'nodejs'

const CreateSchema = z.object({
  code: z.string().trim().min(3).max(40),
  kind: z.enum(['discount', 'invoice_later']),
  /** Discount kind only. */
  percentOff: z.number().int().min(1).max(100).optional().nullable(),
  /** Discount scope — service type keys; empty = every service. */
  serviceTypes: z.array(z.string().min(1).max(60)).max(50).optional(),
  startsAt: z.string().datetime().optional().nullable(),
  expiresAt: z.string().datetime().optional().nullable(),
  maxRedemptions: z.number().int().min(1).max(100000).optional().nullable(),
  /** 0036 — non-empty = private code: only these clients can use it, and
   *  it auto-applies on their bookings. Empty/omitted = public. */
  assignedClientIds: z.array(z.string().uuid()).max(500).optional(),
  notes: z.string().trim().max(500).optional().nullable(),
})

/** GET /api/admin/promos — all codes, newest first (admin only). */
export async function GET() {
  const session = await authorizeRequest('admin')
  if (session instanceof Response) return session

  try {
    const rows = await withServiceRole((tx) =>
      tx.select().from(promoCodes).orderBy(desc(promoCodes.createdAt))
    ).catch(() => [])
    return ok({ promos: rows })
  } catch (err) {
    return errorResponse(err)
  }
}

/**
 * POST /api/admin/promos — create a code (admin only). Codes are stored
 * uppercased with whitespace stripped; duplicates are rejected.
 */
export async function POST(req: Request) {
  const session = await authorizeRequest('admin')
  if (session instanceof Response) return session

  try {
    const body = CreateSchema.parse(await req.json())
    const code = normalizePromoCode(body.code)
    if (code.length < 3) {
      return Response.json(
        { error: 'Code must be at least 3 characters.' },
        { status: 400 }
      )
    }
    if (body.kind === 'discount' && !body.percentOff) {
      return Response.json(
        { error: 'Discount codes need a percentage.' },
        { status: 400 }
      )
    }

    const row = await withServiceRole(async (tx) => {
      const [inserted] = await tx
        .insert(promoCodes)
        .values({
          code,
          kind: body.kind,
          percentOff: body.kind === 'discount' ? body.percentOff : null,
          serviceTypes:
            body.kind === 'discount' && body.serviceTypes?.length
              ? body.serviceTypes
              : null,
          startsAt: body.startsAt ?? null,
          expiresAt: body.expiresAt ?? null,
          maxRedemptions: body.maxRedemptions ?? null,
          assignedClientIds: body.assignedClientIds?.length
            ? body.assignedClientIds
            : null,
          notes: body.notes || null,
          createdBy: session.userId,
        })
        .returning()
      await logAuditEvent(tx, {
        category: 'billing',
        action: 'promo.created',
        actorUserId: session.userId,
        targetType: 'promo_code',
        targetId: inserted.id,
        payload: {
          code,
          kind: body.kind,
          percentOff: body.percentOff ?? null,
          serviceTypes: body.serviceTypes ?? null,
          expiresAt: body.expiresAt ?? null,
          maxRedemptions: body.maxRedemptions ?? null,
          assignedClientIds: body.assignedClientIds ?? null,
        },
        ipAddress: callerIp(req),
        userAgent: callerUserAgent(req),
      })
      return inserted
    })

    return created({ promo: row })
  } catch (err) {
    // Unique violation on the code — surface a friendly message.
    if (
      err instanceof Error &&
      /duplicate key|promo_codes_code/i.test(err.message)
    ) {
      return Response.json(
        { error: 'A promo code with that name already exists.' },
        { status: 409 }
      )
    }
    return errorResponse(err)
  }
}
