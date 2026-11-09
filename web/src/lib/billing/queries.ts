import 'server-only'
import {
  and,
  asc,
  desc,
  eq,
  exists,
  inArray,
  sql,
} from 'drizzle-orm'
import {
  db,
  invoiceLineItems,
  invoicePayments,
  invoices,
  jobs,
  taxRates,
} from '@/db'
import type {
  Invoice,
  InvoiceKind,
  InvoiceLineItem,
  InvoicePage,
  InvoicePayment,
  InvoiceStatus,
  InvoiceTaxSummaryRow,
} from './provider'

const PAGE_SIZE = 20

/**
 * Scope-aware read helpers for non-admin invoice surfaces.
 *
 * Why these live outside `BillingProvider`: the provider abstraction is
 * for admin lifecycle actions (create, issue, send, void). Recipient
 * surfaces read directly with the appropriate where-clause and lean on
 * Postgres indexes (`invoices_client_idx`, `invoices_org_idx`,
 * `invoice_line_items_job_idx`) for performance.
 *
 * RLS provides defence-in-depth, but we still apply explicit predicates
 * here so we can pre-filter at the SQL level and keep the page handler
 * code-simple.
 */

export type RecipientScope =
  | { kind: 'client'; clientId: string }
  | { kind: 'worker'; workerId: string }

export type RecipientInvoiceListFilter = {
  status?: InvoiceStatus | 'all'
  page?: number
}

export async function loadRecipientInvoices(
  scope: RecipientScope,
  filter: RecipientInvoiceListFilter
): Promise<InvoicePage> {
  const page = Math.max(0, filter.page ?? 0)
  const offset = page * PAGE_SIZE

  const where = and(
    scopeFilter(scope),
    filter.status && filter.status !== 'all'
      ? eq(invoices.status, filter.status)
      : undefined
  )

  const rows = await db
    .select({
      id: invoices.id,
      reference: invoices.reference,
      status: invoices.status,
      kind: invoices.kind,
      parentInvoiceId: invoices.parentInvoiceId,
      issueDate: invoices.issueDate,
      dueDate: invoices.dueDate,
      total: invoices.total,
      paidTotal: invoices.paidTotal,
      currency: invoices.currency,
      clientId: invoices.clientId,
      organisationId: invoices.organisationId,
    })
    .from(invoices)
    .where(where)
    .orderBy(desc(invoices.issueDate), desc(invoices.createdAt))
    .limit(PAGE_SIZE)
    .offset(offset)

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(invoices)
    .where(where)

  return {
    rows: rows.map((r) => ({
      id: r.id,
      reference: r.reference,
      status: r.status as InvoiceStatus,
      kind: r.kind as InvoiceKind,
      parentInvoiceId: r.parentInvoiceId,
      issueDate: r.issueDate,
      dueDate: r.dueDate,
      total: r.total,
      paidTotal: r.paidTotal,
      currency: r.currency,
      clientId: r.clientId,
      organisationId: r.organisationId,
      recipientName: null,
    })),
    total: count ?? 0,
    page,
    pageSize: PAGE_SIZE,
  }
}

/**
 * Recipient detail load. Returns null if the invoice isn't visible to
 * this scope — pages should `notFound()` on null rather than 403'ing,
 * since the client/worker shouldn't be able to enumerate hidden ids
 * through error-code differences. Drafts are hidden from recipients —
 * they're not "real" yet.
 */
export async function loadRecipientInvoice(
  scope: RecipientScope,
  invoiceId: string
): Promise<Invoice | null> {
  const [head] = await db
    .select()
    .from(invoices)
    .where(
      and(
        eq(invoices.id, invoiceId),
        scopeFilter(scope),
        // Recipients never see drafts — they exist only in the admin queue.
        sql`${invoices.status} <> 'draft'`
      )
    )
    .limit(1)
  if (!head) return null

  const lineRows = await db
    .select()
    .from(invoiceLineItems)
    .where(eq(invoiceLineItems.invoiceId, head.id))
    .orderBy(asc(invoiceLineItems.position))

  const paymentRows = await db
    .select()
    .from(invoicePayments)
    .where(eq(invoicePayments.invoiceId, head.id))
    .orderBy(desc(invoicePayments.paidAt))

  return {
    id: head.id,
    reference: head.reference,
    status: head.status as InvoiceStatus,
    kind: head.kind as InvoiceKind,
    parentInvoiceId: head.parentInvoiceId,
    clientId: head.clientId,
    organisationId: head.organisationId,
    issueDate: head.issueDate,
    dueDate: head.dueDate,
    subtotal: head.subtotal,
    taxTotal: head.taxTotal,
    total: head.total,
    paidTotal: head.paidTotal,
    currency: head.currency,
    notes: head.notes,
    taxSummary: parseTaxSummary(head.taxSummary),
    pdfUrl: head.pdfUrl,
    issuedAt: head.issuedAt,
    sentAt: head.sentAt,
    paidAt: head.paidAt,
    voidedAt: head.voidedAt,
    voidReason: head.voidReason,
    lineItems: lineRows.map(
      (r): InvoiceLineItem => ({
        id: r.id,
        jobId: r.jobId,
        description: r.description,
        quantity: r.quantity,
        unitPrice: r.unitPrice,
        taxRateId: r.taxRateId,
        lineSubtotal: r.lineSubtotal,
        lineTax: r.lineTax,
        position: r.position,
      })
    ),
    payments: paymentRows.map(
      (p): InvoicePayment => ({
        id: p.id,
        paidAmount: p.paidAmount,
        paidAt: p.paidAt,
        method: p.method,
        reference: p.reference,
        recordedBy: p.recordedBy,
        note: p.note,
        createdAt: p.createdAt,
      })
    ),
    createdAt: head.createdAt,
    updatedAt: head.updatedAt,
  }
}

/**
 * Resolve the tax-rate labels referenced by the invoice's line items.
 * Returned as a Map keyed by rate id so the page can render
 * "<name> (<percent>%)" cells. Shared with the admin detail page —
 * factor out if a third caller appears.
 */
export async function loadTaxRateLabels(
  rateIds: string[]
): Promise<Map<string, { id: string; name: string; rate: string }>> {
  if (rateIds.length === 0) return new Map()
  const rows = await db
    .select({ id: taxRates.id, name: taxRates.name, rate: taxRates.rate })
    .from(taxRates)
    .where(inArray(taxRates.id, rateIds))
  return new Map(rows.map((r) => [r.id, r]))
}

function scopeFilter(scope: RecipientScope) {
  if (scope.kind === 'client') {
    return eq(invoices.clientId, scope.clientId)
  }
  // Workers see an invoice if any of its line items reference a job they
  // personally posted. Index: `invoice_line_items_job_idx (job_id)`, plus
  // a job lookup by created_by_user_id via the outer EXISTS.
  return exists(
    db
      .select({ one: sql`1` })
      .from(invoiceLineItems)
      .innerJoin(jobs, eq(jobs.id, invoiceLineItems.jobId))
      .where(
        and(
          eq(invoiceLineItems.invoiceId, invoices.id),
          eq(jobs.createdByUserId, scope.workerId)
        )
      )
  )
}

function parseTaxSummary(raw: unknown): InvoiceTaxSummaryRow[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
    .map((r) => ({
      rateId: typeof r.rateId === 'string' ? r.rateId : null,
      code: typeof r.code === 'string' ? r.code : 'untaxed',
      rate: typeof r.rate === 'number' ? r.rate : 0,
      base: typeof r.base === 'number' ? r.base : 0,
      tax: typeof r.tax === 'number' ? r.tax : 0,
    }))
}
