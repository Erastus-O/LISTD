import { eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import {
  errorResponse,
  noContent,
  notFound,
} from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import { recurringInvoiceTemplates, withServiceRole } from '@/db'
import { logAuditEvent } from '@/lib/audit'

export const maxDuration = 15
export const runtime = 'nodejs'

const PatchSchema = z
  .object({
    active: z.boolean().optional(),
    autoAction: z.enum(['draft', 'issued', 'sent']).optional(),
    endsOn: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' })

type Params = { params: Promise<{ id: string }> }

/**
 * PATCH /api/admin/billing/recurring/[id] — partial update. Limited to
 * the fields that are safe to change without re-running the cadence
 * computation: pause / resume, change auto-action, set/clear an end
 * date, edit notes. Changing client / cadence / line items requires
 * creating a new template — keeps the cron's invariant simple.
 *
 * DELETE /api/admin/billing/recurring/[id] — hard delete. Past fires
 * stay in `invoices` (with `created_by` set); the audit row captures
 * the actor.
 */
export async function PATCH(req: Request, { params }: Params) {
  const session = await authorizeRequest('admin')
  if (session instanceof Response) return session

  try {
    const { id } = await params
    const body = PatchSchema.parse(await req.json())

    const result = await withServiceRole(async (tx) => {
      const [existing] = await tx
        .select()
        .from(recurringInvoiceTemplates)
        .where(eq(recurringInvoiceTemplates.id, id))
        .limit(1)
      if (!existing) return null

      const patch: Record<string, unknown> = { updatedAt: sql`now()` }
      if (body.active !== undefined) patch.active = body.active
      if (body.autoAction !== undefined) patch.autoAction = body.autoAction
      if (body.endsOn !== undefined) patch.endsOn = body.endsOn
      if (body.notes !== undefined) patch.notes = body.notes

      await tx
        .update(recurringInvoiceTemplates)
        .set(patch)
        .where(eq(recurringInvoiceTemplates.id, id))

      await logAuditEvent(tx, {
        category: 'billing',
        action: 'recurring_invoice.updated',
        actorUserId: session.userId,
        targetType: 'recurring_invoice_template',
        targetId: id,
        payload: { before: existing, after: body },
      })
      return existing
    })

    if (!result) return notFound('Recurring template not found')
    return noContent()
  } catch (err) {
    console.error('[admin/billing/recurring/:id PATCH] error:', err)
    return errorResponse(err)
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  const session = await authorizeRequest('admin')
  if (session instanceof Response) return session

  try {
    const { id } = await params
    const result = await withServiceRole(async (tx) => {
      const [existing] = await tx
        .select()
        .from(recurringInvoiceTemplates)
        .where(eq(recurringInvoiceTemplates.id, id))
        .limit(1)
      if (!existing) return null

      await tx
        .delete(recurringInvoiceTemplates)
        .where(eq(recurringInvoiceTemplates.id, id))

      await logAuditEvent(tx, {
        category: 'billing',
        action: 'recurring_invoice.deleted',
        actorUserId: session.userId,
        targetType: 'recurring_invoice_template',
        targetId: id,
        payload: {
          clientId: existing.clientId,
          cadence: existing.cadence,
        },
      })
      return existing
    })
    if (!result) return notFound('Recurring template not found')
    return noContent()
  } catch (err) {
    console.error('[admin/billing/recurring/:id DELETE] error:', err)
    return errorResponse(err)
  }
}
