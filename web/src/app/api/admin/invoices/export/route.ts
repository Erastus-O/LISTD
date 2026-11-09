import { errorResponse } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import {
  invoicesToCsv,
  loadInvoicesForExport,
  type InvoiceExportFilter,
} from '@/lib/billing/export'
import type { InvoiceStatus } from '@/lib/billing/provider'

export const maxDuration = 30
export const runtime = 'nodejs'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const VALID_STATUSES: InvoiceStatus[] = [
  'draft',
  'issued',
  'sent',
  'paid',
  'overdue',
  'void',
]

/**
 * GET /api/admin/invoices/export — CSV export of invoices, HMRC bridging-
 * software compatible (Phase 7).
 *
 * Query params:
 *   - from=YYYY-MM-DD     inclusive lower bound on issue_date
 *   - to=YYYY-MM-DD       inclusive upper bound on issue_date
 *   - status=issued,paid  comma-separated whitelist (default omits draft+void)
 *
 * Capped at 10 000 rows; if you need more, paginate with from/to. The
 * file streams as `text/csv` with a date-stamped attachment name.
 */
export async function GET(req: Request) {
  const session = await authorizeRequest('admin')
  if (session instanceof Response) return session

  try {
    const url = new URL(req.url)
    const filter: InvoiceExportFilter = {}

    const from = url.searchParams.get('from')
    if (from && ISO_DATE.test(from)) filter.from = from

    const to = url.searchParams.get('to')
    if (to && ISO_DATE.test(to)) filter.to = to

    const status = url.searchParams.get('status')
    if (status) {
      const parts = status
        .split(',')
        .map((s) => s.trim())
        .filter((s): s is InvoiceStatus =>
          (VALID_STATUSES as string[]).includes(s)
        )
      if (parts.length > 0) filter.statuses = parts
    }

    const rows = await loadInvoicesForExport(filter)
    const csv = invoicesToCsv(rows)

    const stamp = new Date().toISOString().slice(0, 10)
    const rangeSlug =
      filter.from && filter.to
        ? `-${filter.from}_${filter.to}`
        : filter.from
          ? `-from-${filter.from}`
          : filter.to
            ? `-to-${filter.to}`
            : ''

    return new Response(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="invoices${rangeSlug}-${stamp}.csv"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    console.error('[admin/invoices/export] error:', err)
    return errorResponse(err)
  }
}
