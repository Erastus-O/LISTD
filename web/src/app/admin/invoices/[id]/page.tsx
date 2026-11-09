import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, Download, FileText, Receipt } from 'lucide-react'
import { eq, inArray } from 'drizzle-orm'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ProfileAvatar } from '@/components/role/profile-avatar'
import { db, profiles, taxRates } from '@/db'
import { requireRole } from '@/lib/dal'
import { getBillingProvider } from '@/lib/billing/select'
import type { InvoiceStatus } from '@/lib/billing/provider'
import { InvoiceActions } from './_components/invoice-actions'

type Props = { params: Promise<{ id: string }> }

export const metadata = { title: 'Admin · Invoice detail' }
export const dynamic = 'force-dynamic'

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
 * Admin invoice detail. Header (reference, status, recipient avatar),
 * left column: line items + payments. Right column: action panel
 * (status-aware) + dates summary.
 */
export default async function AdminInvoiceDetailPage({ params }: Props) {
  await requireRole('admin')
  const { id } = await params
  const provider = await getBillingProvider()
  const inv = await provider.getInvoice(id)
  if (!inv) notFound()

  // Resolve recipient profile + tax rate labels.
  const [recipient] = await db
    .select({
      userId: profiles.userId,
      fullName: profiles.fullName,
      companyName: profiles.companyName,
      avatarUrl: profiles.avatarUrl,
    })
    .from(profiles)
    .where(eq(profiles.userId, inv.clientId))
    .limit(1)

  const rateIds = Array.from(
    new Set(
      inv.lineItems
        .map((l) => l.taxRateId)
        .filter((x): x is string => Boolean(x))
    )
  )
  const rateRows =
    rateIds.length === 0
      ? []
      : await db
          .select({
            id: taxRates.id,
            name: taxRates.name,
            rate: taxRates.rate,
          })
          .from(taxRates)
          .where(inArray(taxRates.id, rateIds))
  const rateMap = new Map(rateRows.map((r) => [r.id, r]))

  return (
    <div className="w-full space-y-6 px-6 py-10">
      <Link
        href="/admin/invoices"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to invoices
      </Link>

      <div className="flex flex-wrap items-center gap-3">
        <Receipt className="h-7 w-7 text-muted-foreground" />
        <h1 className="font-mono text-2xl text-foreground">
          {inv.reference ??
            (inv.kind === 'credit_note' ? 'Draft credit note' : 'Draft invoice')}
        </h1>
        <Badge variant={STATUS_TONE[inv.status]}>{inv.status}</Badge>
        {inv.kind === 'credit_note' && (
          <Badge variant="outline">Credit note</Badge>
        )}
        {inv.kind === 'credit_note' && inv.parentInvoiceId && (
          <Link
            href={`/admin/invoices/${inv.parentInvoiceId}`}
            className="text-xs text-muted-foreground hover:text-foreground hover:underline"
          >
            offsets parent invoice →
          </Link>
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
              Open PDF
            </a>
          </Button>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        {/* LEFT */}
        <div className="space-y-6">
          <Card>
            <CardContent className="space-y-2 p-6">
              <h2 className="flex items-center gap-1.5 text-sm font-semibold">
                <FileText className="h-4 w-4" /> Bill to
              </h2>
              <div className="flex items-center gap-3">
                <ProfileAvatar
                  url={recipient?.avatarUrl ?? null}
                  name={recipient?.fullName ?? null}
                  size="md"
                />
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {recipient?.companyName ?? recipient?.fullName ?? '—'}
                  </p>
                  {recipient?.companyName && recipient.fullName && (
                    <p className="text-xs text-muted-foreground">
                      {recipient.fullName}
                    </p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

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
                        ? rateMap.get(line.taxRateId)
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
                  <span>Total</span>
                  <span>{formatMoney(inv.total, inv.currency)}</span>
                </div>
                {Number(inv.paidTotal) > 0 && (
                  <div className="flex items-center justify-between pt-1 text-xs text-muted-foreground">
                    <span>Paid</span>
                    <span>{formatMoney(inv.paidTotal, inv.currency)}</span>
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
                      {p.note && (
                        <p className="max-w-[260px] text-right text-[11px] text-muted-foreground">
                          {p.note}
                        </p>
                      )}
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

        {/* RIGHT */}
        <div className="space-y-6">
          <Card>
            <CardContent className="space-y-2 p-6 text-sm">
              <h2 className="text-sm font-semibold">Dates</h2>
              <Row label="Issued">{inv.issueDate ?? '—'}</Row>
              <Row label="Due">{inv.dueDate ?? '—'}</Row>
              {inv.sentAt && (
                <Row label="Sent">{formatDateTime(inv.sentAt)}</Row>
              )}
              {inv.paidAt && (
                <Row label="Paid">{formatDateTime(inv.paidAt)}</Row>
              )}
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

          <InvoiceActions
            invoiceId={inv.id}
            status={inv.status}
            kind={inv.kind}
            total={inv.total}
            paidTotal={inv.paidTotal}
            currency={inv.currency}
            hasPdf={!!inv.pdfUrl}
            creditNoteLineSeed={inv.lineItems.map((l) => ({
              description: l.description,
              quantity: Number(l.quantity),
              unitPrice: Number(l.unitPrice),
              taxRateId: l.taxRateId,
              jobId: l.jobId,
            }))}
          />
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
