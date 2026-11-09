import { and, eq, lte, sql } from 'drizzle-orm'
import { errorResponse, ok, unauthorized } from '@/lib/api'
import {
  db,
  recurringInvoiceTemplates,
  withServiceRole,
} from '@/db'
import { logAuditEvent } from '@/lib/audit'
import { verifyCronAuth, verifyExternalApiKey } from '@/lib/webhooks'
import { getBillingProvider } from '@/lib/billing/select'
import {
  BillingProviderNotImplementedError,
  type InvoiceLineItemDraft,
} from '@/lib/billing/provider'
import { advanceNextRun, isoDate, type Cadence } from '@/lib/billing/recurring'

export const maxDuration = 60
export const runtime = 'nodejs'

type TemplateRow = {
  id: string
  clientId: string
  organisationId: string | null
  cadence: string
  dayOfMonth: number | null
  dayOfWeek: number | null
  endsOn: string | null
  nextRunAt: string
  notes: string | null
  lineItems: unknown
  autoAction: string
  createdBy: string | null
}

/**
 * GET /api/cron/issue-recurring — daily sweep that mints + (optionally
 * issues + sends) draft invoices from active recurring templates whose
 * `next_run_at` has arrived.
 *
 * Strategy:
 *  1. Select active templates with `next_run_at <= today` AND
 *     (`ends_on` IS NULL OR `ends_on` >= today).
 *  2. For each: call provider.createInvoice with the snapshot line items.
 *  3. Per `auto_action`: leave as draft, or auto-issue, or auto-issue + send.
 *  4. Advance `next_run_at` via `advanceNextRun(today, spec)` and write
 *     `last_run_at` + `last_invoice_id`.
 *  5. Audit each fire with `billing/recurring_invoice.fired`.
 *
 * Idempotency: the per-template advance ensures the same date won't be
 * processed twice. If the provider create fails we leave next_run_at
 * unchanged so the next cron run retries. (At-least-once delivery; the
 * provider create is itself transactional.)
 *
 * Vercel Cron schedule: daily at 07:00 UTC (vercel.json).
 */
export async function GET(req: Request) {
  if (!verifyCronAuth(req) && !verifyExternalApiKey(req)) {
    return unauthorized()
  }

  try {
    const todayIso = isoDate(new Date())
    const provider = await getBillingProvider()

    const due = (await db
      .select({
        id: recurringInvoiceTemplates.id,
        clientId: recurringInvoiceTemplates.clientId,
        organisationId: recurringInvoiceTemplates.organisationId,
        cadence: recurringInvoiceTemplates.cadence,
        dayOfMonth: recurringInvoiceTemplates.dayOfMonth,
        dayOfWeek: recurringInvoiceTemplates.dayOfWeek,
        endsOn: recurringInvoiceTemplates.endsOn,
        nextRunAt: recurringInvoiceTemplates.nextRunAt,
        notes: recurringInvoiceTemplates.notes,
        lineItems: recurringInvoiceTemplates.lineItems,
        autoAction: recurringInvoiceTemplates.autoAction,
        createdBy: recurringInvoiceTemplates.createdBy,
      })
      .from(recurringInvoiceTemplates)
      .where(
        and(
          eq(recurringInvoiceTemplates.active, true),
          lte(recurringInvoiceTemplates.nextRunAt, todayIso)
        )
      )) as TemplateRow[]

    const fired: Array<{
      templateId: string
      invoiceId: string
      action: string
    }> = []
    const failed: Array<{ templateId: string; error: string }> = []

    for (const t of due) {
      if (t.endsOn && t.endsOn < todayIso) {
        // Past end-date; deactivate and audit.
        await withServiceRole(async (tx) => {
          await tx
            .update(recurringInvoiceTemplates)
            .set({ active: false, updatedAt: sql`now()` })
            .where(eq(recurringInvoiceTemplates.id, t.id))
          await logAuditEvent(tx, {
            category: 'billing',
            action: 'recurring_invoice.completed',
            actorUserId: null,
            targetType: 'recurring_invoice_template',
            targetId: t.id,
            payload: { actor: 'cron', endsOn: t.endsOn },
          })
        })
        continue
      }

      const lineItems = normaliseLineItems(t.lineItems)
      if (lineItems.length === 0) {
        failed.push({
          templateId: t.id,
          error: 'Template has no line items.',
        })
        continue
      }

      try {
        const draft = await provider.createInvoice(
          {
            clientId: t.clientId,
            organisationId: t.organisationId,
            notes: t.notes ?? null,
            lineItems,
          },
          t.createdBy ?? '00000000-0000-0000-0000-000000000000'
        )

        let finalAction: 'draft' | 'issued' | 'sent' = 'draft'
        if (t.autoAction === 'issued' || t.autoAction === 'sent') {
          await provider.issueInvoice(draft.id, t.createdBy ?? '')
          finalAction = 'issued'
        }
        if (t.autoAction === 'sent') {
          try {
            await provider.sendInvoiceEmail(draft.id, t.createdBy ?? '')
            finalAction = 'sent'
          } catch (sendErr) {
            // Issuing succeeded but emailing didn't — leave the invoice
            // as 'issued' and surface the send error in the cron log.
            console.warn(
              '[cron/issue-recurring] auto-send failed for',
              draft.id,
              sendErr
            )
          }
        }

        const nextRun = advanceNextRun(todayIso, {
          cadence: t.cadence as Cadence,
          dayOfMonth: t.dayOfMonth,
          dayOfWeek: t.dayOfWeek,
        })

        await withServiceRole(async (tx) => {
          await tx
            .update(recurringInvoiceTemplates)
            .set({
              nextRunAt: nextRun,
              lastRunAt: sql`now()`,
              lastInvoiceId: draft.id,
              updatedAt: sql`now()`,
            })
            .where(eq(recurringInvoiceTemplates.id, t.id))

          await logAuditEvent(tx, {
            category: 'billing',
            action: 'recurring_invoice.fired',
            actorUserId: null,
            targetType: 'recurring_invoice_template',
            targetId: t.id,
            payload: {
              actor: 'cron',
              invoiceId: draft.id,
              cadence: t.cadence,
              nextRunAt: nextRun,
              finalAction,
              lineCount: lineItems.length,
            },
          })
        })

        fired.push({ templateId: t.id, invoiceId: draft.id, action: finalAction })
      } catch (err) {
        if (err instanceof BillingProviderNotImplementedError) {
          failed.push({ templateId: t.id, error: err.message })
        } else {
          console.error('[cron/issue-recurring] template fire failed:', t.id, err)
          failed.push({
            templateId: t.id,
            error: err instanceof Error ? err.message : 'Unknown error',
          })
        }
      }
    }

    return ok({
      success: true,
      processed: due.length,
      firedCount: fired.length,
      fired,
      failed,
    })
  } catch (err) {
    console.error('[cron/issue-recurring] error:', err)
    return errorResponse(err)
  }
}

function normaliseLineItems(raw: unknown): InvoiceLineItemDraft[] {
  if (!Array.isArray(raw)) return []
  const out: InvoiceLineItemDraft[] = []
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue
    const o = r as Record<string, unknown>
    const description = typeof o.description === 'string' ? o.description : ''
    const unitPriceNum = Number(o.unitPrice)
    if (!description || !Number.isFinite(unitPriceNum)) continue
    out.push({
      description,
      quantity:
        typeof o.quantity === 'number' && Number.isFinite(o.quantity)
          ? o.quantity
          : 1,
      unitPrice: unitPriceNum,
      taxRateId: typeof o.taxRateId === 'string' ? o.taxRateId : null,
      jobId: typeof o.jobId === 'string' ? o.jobId : null,
      position:
        typeof o.position === 'number' && Number.isFinite(o.position)
          ? o.position
          : undefined,
    })
  }
  return out
}
