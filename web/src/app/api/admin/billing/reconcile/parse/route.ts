import { errorResponse, ok } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import { matchRowsToInvoices, parseBankCsv } from '@/lib/billing/reconcile'

export const maxDuration = 30
export const runtime = 'nodejs'

/**
 * POST /api/admin/billing/reconcile/parse — accepts a bank CSV as raw
 * text in the request body and returns parsed credit rows paired with
 * proposed invoice matches.
 *
 * Body: `text/plain` or `text/csv`; do NOT send JSON. The CSV is parsed
 * with a permissive header mapper (`parseBankCsv`) so admins can paste
 * exports from Lloyds / HSBC / Barclays / generic without reshaping.
 *
 * The response shape is `MatchedRow[]` — the page handler walks this
 * array and renders a confirm/edit UI before POSTing to the sibling
 * `/match` route to actually record payments.
 */
export async function POST(req: Request) {
  const session = await authorizeRequest('admin')
  if (session instanceof Response) return session

  try {
    const raw = await req.text()
    if (!raw.trim()) {
      return ok({ rows: [] })
    }
    const rows = parseBankCsv(raw)
    const matches = await matchRowsToInvoices(rows)
    return ok({ rows: matches })
  } catch (err) {
    console.error('[admin/billing/reconcile/parse] error:', err)
    return errorResponse(err)
  }
}
