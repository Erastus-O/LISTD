import { and, eq, ne, sql } from 'drizzle-orm'
import { z } from 'zod'
import { errorResponse, noContent, notFound } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import { taxRates, withServiceRole } from '@/db'
import { callerIp, callerUserAgent, logAuditEvent } from '@/lib/audit'

export const maxDuration = 15
export const runtime = 'nodejs'

const PatchSchema = z
  .object({
    code: z.string().trim().min(1).max(40).optional(),
    name: z.string().trim().min(1).max(120).optional(),
    rate: z.number().min(0).max(1).optional(),
    appliesTo: z.string().trim().max(40).optional(),
    notes: z.string().trim().max(400).nullable().optional(),
    xeroTaxType: z.string().trim().max(40).nullable().optional(),
    isActive: z.boolean().optional(),
    isDefault: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' })

type Params = { params: Promise<{ id: string }> }

/**
 * PATCH /api/admin/billing/tax-rates/[id] — update a tax rate.
 *
 * Mutually exclusive `isDefault`: setting this row to default clears the
 * flag on any other row first. Setting it to false explicitly is allowed
 * (and may leave the system with no default — admins should set a new
 * one immediately if they did this by accident).
 */
export async function PATCH(req: Request, { params }: Params) {
  const session = await authorizeRequest('admin')
  if (session instanceof Response) return session

  try {
    const { id } = await params
    const body = PatchSchema.parse(await req.json())
    const ip = callerIp(req)
    const ua = callerUserAgent(req)

    const updated = await withServiceRole(async (tx) => {
      const [existing] = await tx
        .select()
        .from(taxRates)
        .where(eq(taxRates.id, id))
        .limit(1)
      if (!existing) return null

      if (body.isDefault === true) {
        await tx
          .update(taxRates)
          .set({ isDefault: false, updatedAt: sql`now()` })
          .where(and(eq(taxRates.isDefault, true), ne(taxRates.id, id)))
      }

      const patch: Record<string, unknown> = { updatedAt: sql`now()` }
      if (body.code !== undefined) patch.code = body.code
      if (body.name !== undefined) patch.name = body.name
      if (body.rate !== undefined) patch.rate = body.rate.toString()
      if (body.appliesTo !== undefined) patch.appliesTo = body.appliesTo
      if (body.notes !== undefined) patch.notes = body.notes
      if (body.xeroTaxType !== undefined) patch.xeroTaxType = body.xeroTaxType
      if (body.isActive !== undefined) patch.isActive = body.isActive
      if (body.isDefault !== undefined) patch.isDefault = body.isDefault

      await tx.update(taxRates).set(patch).where(eq(taxRates.id, id))

      await logAuditEvent(tx, {
        category: 'billing',
        action: 'tax_rate.updated',
        actorUserId: session.userId,
        targetType: 'tax_rate',
        targetId: id,
        payload: {
          before: {
            code: existing.code,
            name: existing.name,
            rate: existing.rate,
            isActive: existing.isActive,
            isDefault: existing.isDefault,
          },
          after: body,
        },
        ipAddress: ip,
        userAgent: ua,
      })

      return existing
    })

    if (!updated) return notFound('Tax rate not found')
    return noContent()
  } catch (err) {
    console.error('[admin/billing/tax-rates/:id PATCH] error:', err)
    return errorResponse(err)
  }
}
