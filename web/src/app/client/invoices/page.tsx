import { Receipt } from 'lucide-react'
import { Pager } from '@/components/admin/pager'
import { InvoiceListTable } from '@/components/billing/invoice-list-table'
import { requireRole } from '@/lib/dal'
import { loadRecipientInvoices } from '@/lib/billing/queries'
import type { InvoiceListFilter, InvoiceStatus } from '@/lib/billing/provider'

export const metadata = { title: 'Client · Invoices' }
export const dynamic = 'force-dynamic'

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

const VALID_STATUSES: ReadonlyArray<InvoiceStatus | 'all'> = [
  'all',
  'issued',
  'sent',
  'paid',
  'overdue',
  'void',
]

/**
 * Client invoices list. Scoped to invoices where `clientId = session.userId`.
 * Drafts are filtered out by the loader — the recipient sees an invoice
 * only once it's been issued.
 */
export default async function ClientInvoicesPage({ searchParams }: Props) {
  const session = await requireRole('client')
  const sp = await searchParams
  const filter = parseFilter(sp)

  const data = await loadRecipientInvoices(
    { kind: 'client', clientId: session.userId },
    filter
  )

  const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize))
  const pageHref = (n: number) => {
    const next = new URLSearchParams()
    if (filter.status) next.set('status', filter.status)
    if (n > 0) next.set('page', String(n))
    const qs = next.toString()
    return qs ? `/client/invoices?${qs}` : '/client/invoices'
  }

  return (
    <div className="w-full space-y-6 px-6 py-10">
      <div className="flex items-center gap-2">
        <Receipt className="h-6 w-6 text-muted-foreground" />
        <div>
          <h1 className="font-display text-3xl text-foreground">Invoices</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            {data.total} {data.total === 1 ? 'invoice' : 'invoices'}
            {totalPages > 1 ? ` · page ${data.page + 1} of ${totalPages}` : ''}
          </p>
        </div>
      </div>

      <InvoiceListTable
        data={data}
        detailBase="/client/invoices"
        emptyMessage="No invoices yet. They'll appear here once the team issues one."
      />

      <Pager page={data.page} totalPages={totalPages} href={pageHref} />
    </div>
  )
}

function parseFilter(
  sp: Record<string, string | string[] | undefined>
): InvoiceListFilter {
  const f: InvoiceListFilter = {}
  const status = first(sp.status)
  if (status && (VALID_STATUSES as readonly string[]).includes(status)) {
    f.status = status as InvoiceListFilter['status']
  }
  const page = first(sp.page)
  if (page) {
    const n = Number.parseInt(page, 10)
    if (Number.isFinite(n) && n >= 0) f.page = n
  }
  return f
}

function first(v: string | string[] | undefined): string | undefined {
  if (!v) return undefined
  return Array.isArray(v) ? v[0] : v
}
