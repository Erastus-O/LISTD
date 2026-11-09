import 'server-only'
import { alias } from 'drizzle-orm/pg-core'
import { and, asc, eq, gte, inArray, lte, ne } from 'drizzle-orm'
import { db, invoices, profiles } from '@/db'
import type { InvoiceStatus, InvoiceTaxSummaryRow } from './provider'

/**
 * CSV export helpers for HMRC bridging-software compatible invoice
 * downloads (Phase 7).
 *
 * Shape decisions:
 *   - One row per invoice (not per line item) — bridging tools sum
 *     totals per invoice for the VAT return, so a flat invoice-level
 *     row is the lowest-friction format.
 *   - Default filter excludes `draft` and `void`. Drafts aren't real
 *     yet, voids must keep their reference per HMRC record-keeping but
 *     shouldn't be summed into a return.
 *   - VAT breakdown is flattened to a `code:tax;code:tax` string so the
 *     export stays single-row-per-invoice while preserving per-rate
 *     detail for spot-checks.
 */

export type InvoiceExportFilter = {
  /** Inclusive YYYY-MM-DD bounds on `issue_date`. */
  from?: string
  to?: string
  /** Status whitelist. Default: `['issued', 'sent', 'paid', 'overdue']` —
   *  the set that's safe to feed into a VAT return. */
  statuses?: InvoiceStatus[]
}

export type InvoiceExportRow = {
  reference: string
  kind: string
  parentReference: string
  issueDate: string
  dueDate: string
  status: string
  clientName: string
  currency: string
  subtotal: string
  taxTotal: string
  total: string
  paidTotal: string
  outstanding: string
  vatBreakdown: string
  notes: string
}

const DEFAULT_STATUSES: InvoiceStatus[] = ['issued', 'sent', 'paid', 'overdue']
const MAX_ROWS = 10_000

export async function loadInvoicesForExport(
  filter: InvoiceExportFilter
): Promise<InvoiceExportRow[]> {
  const statuses = filter.statuses?.length ? filter.statuses : DEFAULT_STATUSES

  const clauses = [inArray(invoices.status, statuses)]
  if (filter.from) clauses.push(gte(invoices.issueDate, filter.from))
  if (filter.to) clauses.push(lte(invoices.issueDate, filter.to))
  // Belt-and-braces: even if the caller overrides statuses we never emit
  // pure drafts (no reference, no issue date) since they'd corrupt a VAT
  // return.
  clauses.push(ne(invoices.status, 'draft'))

  // Self-join for parent invoice reference on credit-note rows. Uses the
  // standard `alias()` helper so the join is read by the planner as a
  // distinct table (`parent`) without polluting the main `invoices`
  // selection.
  const parent = alias(invoices, 'parent')
  const rows = await db
    .select({
      reference: invoices.reference,
      kind: invoices.kind,
      parentReference: parent.reference,
      issueDate: invoices.issueDate,
      dueDate: invoices.dueDate,
      status: invoices.status,
      currency: invoices.currency,
      subtotal: invoices.subtotal,
      taxTotal: invoices.taxTotal,
      total: invoices.total,
      paidTotal: invoices.paidTotal,
      taxSummary: invoices.taxSummary,
      notes: invoices.notes,
      clientFullName: profiles.fullName,
      clientCompany: profiles.companyName,
    })
    .from(invoices)
    .leftJoin(profiles, eq(profiles.userId, invoices.clientId))
    .leftJoin(parent, eq(parent.id, invoices.parentInvoiceId))
    .where(and(...clauses))
    .orderBy(asc(invoices.issueDate), asc(invoices.reference))
    .limit(MAX_ROWS)

  return rows.map((r): InvoiceExportRow => {
    const isCreditNote = r.kind === 'credit_note'
    // Credit notes reduce a balance — express their totals as negative
    // values in the CSV so a downstream SUM gives the correct net VAT
    // base/output. The invoice row's own signage stays positive in DB.
    const sign = isCreditNote ? -1 : 1
    const subtotal = Number(r.subtotal) * sign
    const taxTotal = Number(r.taxTotal) * sign
    const total = Number(r.total) * sign
    const paidTotal = Number(r.paidTotal) * sign
    const outstanding =
      Math.round((total - paidTotal) * 100) / 100
    const breakdown = parseTaxSummary(r.taxSummary)
      .map((t) => `${t.code}:${(t.tax * sign).toFixed(2)}`)
      .join(';')
    return {
      reference: r.reference ?? '',
      kind: r.kind,
      parentReference: r.parentReference ?? '',
      issueDate: r.issueDate ?? '',
      dueDate: r.dueDate ?? '',
      status: r.status,
      clientName: r.clientCompany ?? r.clientFullName ?? '',
      currency: r.currency,
      subtotal: subtotal.toFixed(2),
      taxTotal: taxTotal.toFixed(2),
      total: total.toFixed(2),
      paidTotal: paidTotal.toFixed(2),
      outstanding: outstanding.toFixed(2),
      vatBreakdown: breakdown,
      notes: (r.notes ?? '').replace(/\s+/g, ' ').slice(0, 500),
    }
  })
}

export function invoicesToCsv(rows: InvoiceExportRow[]): string {
  const header: Array<keyof InvoiceExportRow> = [
    'reference',
    'kind',
    'parentReference',
    'issueDate',
    'dueDate',
    'status',
    'clientName',
    'currency',
    'subtotal',
    'taxTotal',
    'total',
    'paidTotal',
    'outstanding',
    'vatBreakdown',
    'notes',
  ]
  const lines = [header.map(csvEscape).join(',')]
  for (const r of rows) {
    lines.push(header.map((k) => csvEscape(r[k])).join(','))
  }
  return lines.join('\r\n')
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

function csvEscape(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}
