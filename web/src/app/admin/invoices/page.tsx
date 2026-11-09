import Link from 'next/link'
import { FileText, Plus } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Pager } from '@/components/admin/pager'
import { requireRole } from '@/lib/dal'
import { BillingProviderNotImplementedError } from '@/lib/billing/provider'
import {
  getBillingProvider,
  loadBillingProviderId,
} from '@/lib/billing/select'
import type {
  InvoiceListFilter,
  InvoicePage,
  InvoiceStatus,
} from '@/lib/billing/provider'
import { ExportCsvButton } from './_components/export-csv-button'
import { InvoicesFilterBar } from './_components/invoices-filter-bar'

export const metadata = { title: 'Admin · Invoices' }
export const dynamic = 'force-dynamic'

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

const STATUS_TONE: Record<
  InvoiceStatus,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  draft: 'outline',
  issued: 'default',
  sent: 'default',
  paid: 'secondary',
  overdue: 'destructive',
  void: 'destructive',
}

const VALID_STATUSES: ReadonlyArray<InvoiceStatus | 'all'> = [
  'all',
  'draft',
  'issued',
  'sent',
  'paid',
  'overdue',
  'void',
]

/**
 * Admin Invoices list. Routes through the active billing provider — for
 * `provider = xero` (stub today) we surface a friendly empty state
 * pointing to the toggle. For `provider = inbuilt` we render the table.
 *
 * Pagination + status filter via URL params, search by reference.
 */
export default async function AdminInvoicesPage({ searchParams }: Props) {
  await requireRole('admin')
  const sp = await searchParams
  const filter = parseFilter(sp)
  const providerId = await loadBillingProviderId()

  let data: InvoicePage | null = null
  let providerError: string | null = null
  if (providerId === 'inbuilt') {
    const provider = await getBillingProvider()
    try {
      data = await provider.listInvoices(filter)
    } catch (err) {
      if (err instanceof BillingProviderNotImplementedError) {
        providerError = err.message
      } else {
        throw err
      }
    }
  } else {
    providerError = `The ${providerId} billing provider isn't wired yet: flip to "inbuilt" in Settings → Billing to manage invoices here.`
  }

  const total = data?.total ?? 0
  const page = data?.page ?? 0
  const pageSize = data?.pageSize ?? 25
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  const pageHref = (n: number) => {
    const next = new URLSearchParams()
    if (filter.status) next.set('status', filter.status)
    if (filter.kind) next.set('kind', filter.kind)
    if (filter.q) next.set('q', filter.q)
    if (n > 0) next.set('page', String(n))
    const qs = next.toString()
    return qs ? `/admin/invoices?${qs}` : '/admin/invoices'
  }

  return (
    <div className="w-full space-y-6 px-6 py-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <FileText className="h-6 w-6 text-muted-foreground" />
          <div>
            <h1 className="font-display text-3xl text-foreground">Invoices</h1>
            <p className="mt-1 text-xs text-muted-foreground">
              {providerError
                ? 'Billing provider not active'
                : `${total} ${total === 1 ? 'invoice' : 'invoices'}${totalPages > 1 ? ` · page ${page + 1} of ${totalPages}` : ''}`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ExportCsvButton />
          <Button asChild size="sm" className="gap-1.5">
            <Link href="/admin/invoices/new">
              <Plus className="h-4 w-4" />
              New invoice
            </Link>
          </Button>
        </div>
      </div>

      <InvoicesFilterBar />

      {providerError ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            {providerError}
          </CardContent>
        </Card>
      ) : !data || data.rows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No invoices match this filter.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5 text-left font-medium">
                      Reference
                    </th>
                    <th className="px-4 py-2.5 text-left font-medium">
                      Recipient
                    </th>
                    <th className="px-4 py-2.5 text-left font-medium">Status</th>
                    <th className="px-4 py-2.5 text-left font-medium">
                      Issue date
                    </th>
                    <th className="px-4 py-2.5 text-left font-medium">
                      Due date
                    </th>
                    <th className="px-4 py-2.5 text-right font-medium">Total</th>
                    <th className="px-4 py-2.5 text-right font-medium">Paid</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data.rows.map((r) => (
                    <tr key={r.id} className="hover:bg-muted/30">
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-1.5">
                          <Link
                            href={`/admin/invoices/${r.id}`}
                            className="font-mono text-xs text-primary hover:underline"
                          >
                            {r.reference ?? 'Draft'}
                          </Link>
                          {r.kind === 'credit_note' && (
                            <Badge
                              variant="outline"
                              className="text-[9px] uppercase tracking-wide"
                            >
                              CN
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td className="max-w-[260px] truncate px-4 py-2.5 text-xs">
                        {r.recipientName ?? '—'}
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge variant={STATUS_TONE[r.status]}>
                          {r.status}
                        </Badge>
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-xs">
                        {r.issueDate ?? '—'}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-xs">
                        {r.dueDate ?? '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right text-xs">
                        {formatMoney(r.total, r.currency)}
                      </td>
                      <td className="px-4 py-2.5 text-right text-xs">
                        {formatMoney(r.paidTotal, r.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {!providerError && (
        <Pager page={page} totalPages={totalPages} href={pageHref} />
      )}
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
  const kind = first(sp.kind)
  if (kind === 'invoice' || kind === 'credit_note' || kind === 'all') {
    f.kind = kind
  }
  const q = first(sp.q)
  if (q) f.q = q
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

function formatMoney(value: string | number, currency: string): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency,
  }).format(Number(value))
}
