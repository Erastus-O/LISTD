import { z } from 'zod'
import { created, errorResponse } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import { recurringInvoiceTemplates, withServiceRole } from '@/db'
import { logAuditEvent } from '@/lib/audit'
import { firstRunAfter, isoDate } from '@/lib/billing/recurring'

export const maxDuration = 15
export const runtime = 'nodejs'

const LineItemSchema = z.object({
  description: z.string().trim().min(1).max(500),
  quantity: z.number().positive().max(100_000).optional(),
  unitPrice: z.number().min(0).max(1_000_000),
  taxRateId: z.string().uuid().nullable().optional(),
  jobId: z.string().uuid().nullable().optional(),
  position: z.number().int().min(0).max(100).optional(),
})

const RequestSchema = z
  .object({
    clientId: z.string().uuid(),
    organisationId: z.string().uuid().nullable().optional(),
    cadence: z.enum(['monthly', 'weekly', 'quarterly']),
    dayOfMonth: z.number().int().min(1).max(28).nullable().optional(),
    dayOfWeek: z.number().int().min(0).max(6).nullable().optional(),
    startsOn: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    endsOn: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .optional(),
    autoAction: z.enum(['draft', 'issued', 'sent']).default('issued'),
    notes: z.string().trim().max(2000).nullable().optional(),
    lineItems: z.array(LineItemSchema).min(1).max(60),
  })
  .strict()

/**
 * POST /api/admin/billing/recurring — create a recurring invoice
 * template. Admin only. `next_run_at` is pre-computed from the cadence
 * + start date so the cron's WHERE clause stays a cheap index scan.
 */
export async function POST(req: Request) {
  const session = await authorizeRequest('admin')
  if (session instanceof Response) return session

  try {
    const body = RequestSchema.parse(await req.json())
    const startsOn = body.startsOn ?? isoDate(new Date())
    const nextRunAt = firstRunAfter(startsOn, {
      cadence: body.cadence,
      dayOfMonth: body.dayOfMonth ?? null,
      dayOfWeek: body.dayOfWeek ?? null,
    })

    const id = await withServiceRole(async (tx) => {
      const [row] = await tx
        .insert(recurringInvoiceTemplates)
        .values({
          clientId: body.clientId,
          organisationId: body.organisationId ?? null,
          cadence: body.cadence,
          dayOfMonth: body.dayOfMonth ?? null,
          dayOfWeek: body.dayOfWeek ?? null,
          startsOn,
          endsOn: body.endsOn ?? null,
          nextRunAt,
          notes: body.notes ?? null,
          lineItems: body.lineItems,
          autoAction: body.autoAction,
          createdBy: session.userId,
        })
        .returning({ id: recurringInvoiceTemplates.id })

      await logAuditEvent(tx, {
        category: 'billing',
        action: 'recurring_invoice.created',
        actorUserId: session.userId,
        targetType: 'recurring_invoice_template',
        targetId: row.id,
        payload: {
          clientId: body.clientId,
          cadence: body.cadence,
          autoAction: body.autoAction,
          nextRunAt,
          lineCount: body.lineItems.length,
        },
      })
      return row.id
    })

    return created({ id, nextRunAt })
  } catch (err) {
    console.error('[admin/billing/recurring POST] error:', err)
    return errorResponse(err)
  }
}

