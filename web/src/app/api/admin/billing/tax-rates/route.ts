import { eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { badRequest, created, errorResponse } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import { taxRates, withServiceRole } from '@/db'
import { callerIp, callerUserAgent, logAuditEvent } from '@/lib/audit'

export const maxDuration = 15
export const runtime = 'nodejs'

const CreateSchema = z
  .object({
    code: z.string().trim().min(1).max(40),
    name: z.string().trim().min(1).max(120),
    /** Decimal fraction, e.g. 0.2 for 20 %. Range 0 – 1 (no rate above 100 %). */
    rate: z.number().min(0).max(1),
    appliesTo: z.string().trim().max(40).default('domestic'),
    notes: z.string().trim().max(400).optional().nullable(),
    xeroTaxType: z.string().trim().max(40).optional().nullable(),
    isActive: z.boolean().default(true),
    isDefault: z.boolean().default(false),
  })
  .strict()

/**
 * POST /api/admin/billing/tax-rates — create a new tax rate row. Admin-only.
 *
 * `isDefault` is exclusive — flipping it on for a new row clears the
 * existing default in the same tx so the invariant "at most one default
 * rate" stays true. Both writes audit individually.
 */
export async function POST(req: Request) {
  const session = await authorizeRequest('admin')
  if (session instanceof Response) return session

  try {
    const body = CreateSchema.parse(await req.json())
    const ip = callerIp(req)
    const ua = callerUserAgent(req)

    const inserted = await withServiceRole(async (tx) => {
      if (body.isDefault) {
        await tx
          .update(taxRates)
          .set({ isDefault: false, updatedAt: sql`now()` })
          .where(eq(taxRates.isDefault, true))
      }
      const [row] = await tx
        .insert(taxRates)
        .values({
          code: body.code,
          name: body.name,
          rate: body.rate.toString(),
          appliesTo: body.appliesTo,
          notes: body.notes ?? null,
          xeroTaxType: body.xeroTaxType ?? null,
          isActive: body.isActive,
          isDefault: body.isDefault,
        })
        .returning({ id: taxRates.id })

      await logAuditEvent(tx, {
        category: 'billing',
        action: 'tax_rate.created',
        actorUserId: session.userId,
        targetType: 'tax_rate',
        targetId: row.id,
        payload: {
          code: body.code,
          name: body.name,
          rate: body.rate,
          isActive: body.isActive,
          isDefault: body.isDefault,
        },
        ipAddress: ip,
        userAgent: ua,
      })
      return row
    })

    return created({ id: inserted.id })
  } catch (err) {
    if (err instanceof Error && /tax_rates_code_key/i.test(err.message)) {
      return badRequest('A tax rate with that code already exists.')
    }
    console.error('[admin/billing/tax-rates POST] error:', err)
    return errorResponse(err)
  }
}
