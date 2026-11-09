import { Receipt } from 'lucide-react'
import { Pager } from '@/components/admin/pager'
import { InvoiceListTable } from '@/components/billing/invoice-list-table'
import { requireRole } from '@/lib/dal'
import { loadRecipientInvoices } from '@/lib/billing/queries'
import type { InvoiceListFilter, InvoiceStatus } from '@/lib/billing/provider'

export const metadata = { title: 'Worker · Invoices' }
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
 * Worker invoices list. Scoped to invoices that include at least one line
 * item linked to a job the worker personally posted
 * (`jobs.created_by_user_id = workerId`). Workers don't pay invoices — the
 * org owner / client does — so this surface is read-only and informational.
 *
 * If a worker has posted no jobs that have been invoiced, the page shows
 * an empty state pointing back to the booking flow.
 */
export default async function WorkerInvoicesPage({ searchParams }: Props) {
  const session = await requireRole('client', 'admin')
  const sp = await searchParams
  const filter = parseFilter(sp)

  const data = await loadRecipientInvoices(
    { kind: 'worker', workerId: session.userId },
    filter
  )

  const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize))
  const pageHref = (n: number) => {
    const next = new URLSearchParams()
    if (filter.status) next.set('status', filter.status)
    if (n > 0) next.set('page', String(n))
    const qs = next.toString()
    return qs ? `/worker/invoices?${qs}` : '/worker/invoices'
  }

  return (
    <div className="w-full space-y-6 px-6 py-10">
      <div className="flex items-center gap-2">
        <Receipt className="h-6 w-6 text-muted-foreground" />
        <div>
          <h1 className="font-display text-3xl text-foreground">Invoices</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Invoices covering jobs you booked.{' '}
            {data.total} {data.total === 1 ? 'invoice' : 'invoices'}
            {totalPages > 1 ? ` · page ${data.page + 1} of ${totalPages}` : ''}
          </p>
        </div>
      </div>

      <InvoiceListTable
        data={data}
        detailBase="/worker/invoices"
        emptyMessage="No invoices yet: once your bookings are invoiced they'll appear here."
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
