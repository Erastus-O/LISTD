import Link from 'next/link'
import { ArrowLeft, Download, Receipt } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import type { Invoice, InvoiceStatus } from '@/lib/billing/provider'

type Props = {
  invoice: Invoice
  /** Map of taxRate id → { name, rate } for line-item labels. */
  rateLabels: Map<string, { id: string; name: string; rate: string }>
  /** Where the "Back" link points. */
  backHref: string
  backLabel?: string
  /** Optional action panel rendered above the Dates card on the right
   *  column — used by the client detail page to inject the Pay Now button
   *  when Stripe is wired and there's an outstanding balance. */
  actionsSlot?: React.ReactNode
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

/**
 * Read-only invoice detail. Used by both /client/invoices/[id] and
 * /worker/invoices/[id] — neither surface has lifecycle actions, since
 * those live on the admin detail page. PDF is downloadable; outstanding
 * balance is highlighted so recipients see at-a-glance whether anything
 * is owed.
 */
export function InvoiceDetailView({
  invoice,
  rateLabels,
  backHref,
  backLabel = 'Back',
  actionsSlot,
}: Props) {
  const inv = invoice
  const outstanding = round2(Number(inv.total) - Number(inv.paidTotal))

  return (
    <div className="w-full space-y-6 px-6 py-10">
      <Link
        href={backHref}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        {backLabel}
      </Link>

      <div className="flex flex-wrap items-center gap-3">
        <Receipt className="h-7 w-7 text-muted-foreground" />
        <h1 className="font-mono text-2xl text-foreground">
          {inv.reference ?? (inv.kind === 'credit_note' ? 'Credit note' : 'Invoice')}
        </h1>
        <Badge variant={STATUS_TONE[inv.status]}>{inv.status}</Badge>
        {inv.kind === 'credit_note' && (
          <Badge variant="outline">Credit note</Badge>
        )}
        {inv.pdfUrl && (
          <Button
            asChild
            size="sm"
            variant="outline"
            className="ml-auto gap-1.5"
          >
            <a
              href={`/api/billing/invoices/${inv.id}/pdf`}
              target="_blank"
              rel="noreferrer"
            >
              <Download className="h-3.5 w-3.5" />
              Download PDF
            </a>
          </Button>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        {/* LEFT — line items, totals, payments, notes */}
        <div className="space-y-6">
          <Card>
            <CardContent className="space-y-3 p-0">
              <div className="px-6 pt-6">
                <h2 className="text-sm font-semibold">Line items</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-border bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2.5 text-left font-medium">
                        Description
                      </th>
                      <th className="px-4 py-2.5 text-right font-medium">Qty</th>
                      <th className="px-4 py-2.5 text-right font-medium">
                        Unit
                      </th>
                      <th className="px-4 py-2.5 text-right font-medium">Tax</th>
                      <th className="px-4 py-2.5 text-right font-medium">
                        Amount
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {inv.lineItems.map((line) => {
                      const rate = line.taxRateId
                        ? rateLabels.get(line.taxRateId)
                        : null
                      return (
                        <tr key={line.id} className="hover:bg-muted/30">
                          <td className="px-4 py-2.5 text-xs">
                            {line.description}
                          </td>
                          <td className="px-4 py-2.5 text-right text-xs">
                            {Number(line.quantity).toFixed(2).replace(/\.00$/, '')}
                          </td>
                          <td className="px-4 py-2.5 text-right text-xs">
                            {formatMoney(line.unitPrice, inv.currency)}
                          </td>
                          <td className="px-4 py-2.5 text-right text-xs text-muted-foreground">
                            {rate
                              ? `${rate.name} (${(Number(rate.rate) * 100).toFixed(0)}%)`
                              : '—'}
                          </td>
                          <td className="px-4 py-2.5 text-right text-xs">
                            {formatMoney(line.lineSubtotal, inv.currency)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <div className="space-y-1.5 border-t border-border bg-muted/20 px-6 py-4 text-sm">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span>{formatMoney(inv.subtotal, inv.currency)}</span>
                </div>
                {inv.taxSummary.map((t) => (
                  <div
                    key={`${t.rateId ?? 'untaxed'}-${t.code}`}
                    className="flex items-center justify-between text-xs"
                  >
                    <span className="text-muted-foreground">
                      {t.code === 'untaxed'
                        ? 'Untaxed'
                        : `${t.code} (${(t.rate * 100).toFixed(0)}%)`}
                    </span>
                    <span>{formatMoney(t.tax, inv.currency)}</span>
                  </div>
                ))}
                <div className="flex items-center justify-between border-t border-border pt-1.5 text-sm font-semibold">
                  <span>{inv.kind === 'credit_note' ? 'Credit total' : 'Total'}</span>
                  <span>{formatMoney(inv.total, inv.currency)}</span>
                </div>
                {inv.kind !== 'credit_note' && Number(inv.paidTotal) > 0 && (
                  <div className="flex items-center justify-between pt-1 text-xs text-muted-foreground">
                    <span>Paid</span>
                    <span>{formatMoney(inv.paidTotal, inv.currency)}</span>
                  </div>
                )}
                {inv.kind !== 'credit_note' &&
                  outstanding > 0 &&
                  inv.status !== 'void' && (
                    <div className="flex items-center justify-between pt-1 text-xs font-medium text-destructive">
                      <span>Outstanding</span>
                      <span>{formatMoney(outstanding, inv.currency)}</span>
                    </div>
                  )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-3 p-6">
              <h2 className="text-sm font-semibold">
                Payments ({inv.payments.length})
              </h2>
              {inv.payments.length === 0 ? (
                <p className="py-4 text-center text-xs text-muted-foreground">
                  No payments recorded yet.
                </p>
              ) : (
                <ul className="space-y-2">
                  {inv.payments.map((p) => (
                    <li
                      key={p.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-2.5 text-xs"
                    >
                      <div>
                        <p className="font-medium text-foreground">
                          {formatMoney(p.paidAmount, inv.currency)}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {p.paidAt} · {p.method.replace(/_/g, ' ')}
                          {p.reference ? ` · ${p.reference}` : ''}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {inv.notes && (
            <Card>
              <CardContent className="space-y-2 p-6 text-xs">
                <h2 className="text-sm font-semibold">Notes</h2>
                <p className="whitespace-pre-wrap text-muted-foreground">
                  {inv.notes}
                </p>
              </CardContent>
            </Card>
          )}
        </div>

        {/* RIGHT — dates summary */}
        <div className="space-y-6">
          {actionsSlot}
          <Card>
            <CardContent className="space-y-2 p-6 text-sm">
              <h2 className="text-sm font-semibold">Dates</h2>
              <Row label="Issued">{inv.issueDate ?? '—'}</Row>
              <Row label="Due">{inv.dueDate ?? '—'}</Row>
              {inv.sentAt && <Row label="Sent">{formatDateTime(inv.sentAt)}</Row>}
              {inv.paidAt && <Row label="Paid">{formatDateTime(inv.paidAt)}</Row>}
              {inv.voidedAt && (
                <Row label="Voided">{formatDateTime(inv.voidedAt)}</Row>
              )}
              {inv.voidReason && (
                <p className="rounded-md bg-destructive/5 p-2 text-[11px] text-destructive">
                  {inv.voidReason}
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

function Row({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-foreground">{children}</span>
    </div>
  )
}

function formatMoney(value: string | number, currency: string): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency,
  }).format(Number(value))
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
