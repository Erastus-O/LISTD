import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import type { InvoicePage, InvoiceStatus } from '@/lib/billing/provider'

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

type Props = {
  data: InvoicePage | null
  /** Base path each row links into, e.g. `/client/invoices`. */
  detailBase: string
  emptyMessage?: string
}

/**
 * Read-only invoice list table for recipient surfaces (client + worker).
 * The admin list page renders its own table because it surfaces an extra
 * "Recipient" column; the simpler recipient layout drops it.
 */
export function InvoiceListTable({
  data,
  detailBase,
  emptyMessage = 'No invoices to show.',
}: Props) {
  if (!data || data.rows.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          {emptyMessage}
        </CardContent>
      </Card>
    )
  }
  return (
    <Card>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 text-left font-medium">Reference</th>
                <th className="px-4 py-2.5 text-left font-medium">Status</th>
                <th className="px-4 py-2.5 text-left font-medium">Issued</th>
                <th className="px-4 py-2.5 text-left font-medium">Due</th>
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
                        href={`${detailBase}/${r.id}`}
                        className="font-mono text-xs text-primary hover:underline"
                      >
                        {r.reference ?? '—'}
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
                  <td className="px-4 py-2.5">
                    <Badge variant={STATUS_TONE[r.status]}>{r.status}</Badge>
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
  )
}

function formatMoney(value: string | number, currency: string): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency,
  }).format(Number(value))
}
