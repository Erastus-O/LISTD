import { notFound } from 'next/navigation'
import { Card, CardContent } from '@/components/ui/card'
import { InvoiceDetailView } from '@/components/billing/invoice-detail-view'
import { PayNowButton } from '@/components/billing/pay-now-button'
import { requireRole } from '@/lib/dal'
import {
  loadRecipientInvoice,
  loadTaxRateLabels,
} from '@/lib/billing/queries'
import { getBillingProvider } from '@/lib/billing/select'
import { isStripeConfigured } from '@/lib/billing/stripe'

export const metadata = { title: 'Client · Invoice detail' }
export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ id: string }> }

/**
 * Client read-only invoice detail. notFound() rather than 403 if the
 * invoice isn't visible to this client — keeps id enumeration noisy.
 */
export default async function ClientInvoiceDetailPage({ params }: Props) {
  const session = await requireRole('client')
  const { id } = await params

  const inv = await loadRecipientInvoice(
    { kind: 'client', clientId: session.userId },
    id
  )
  if (!inv) notFound()

  const rateIds = Array.from(
    new Set(
      inv.lineItems
        .map((l) => l.taxRateId)
        .filter((x): x is string => Boolean(x))
    )
  )
  const rateLabels = await loadTaxRateLabels(rateIds)

  // "Pay now" is available iff: provider implements payment links AND
  // Stripe is configured at the env level AND the invoice is unpaid AND
  // it has been issued (drafts shouldn't reach this page anyway).
  const provider = await getBillingProvider()
  const outstanding = round2(Number(inv.total) - Number(inv.paidTotal))
  const canPayOnline =
    inv.kind === 'invoice' &&
    outstanding > 0 &&
    inv.status !== 'paid' &&
    inv.status !== 'void' &&
    inv.status !== 'draft' &&
    isStripeConfigured() &&
    typeof provider.createPaymentLink === 'function'

  const actionsSlot = canPayOnline ? (
    <Card>
      <CardContent className="space-y-2 p-6">
        <h2 className="text-sm font-semibold">Pay online</h2>
        <p className="text-xs text-muted-foreground">
          Secure card payment via Stripe. Funds settle into the LISTD Pro
          account; we&rsquo;ll mark the invoice paid automatically.
        </p>
        <PayNowButton
          invoiceId={inv.id}
          outstandingLabel={formatMoney(outstanding, inv.currency)}
        />
      </CardContent>
    </Card>
  ) : null

  return (
    <InvoiceDetailView
      invoice={inv}
      rateLabels={rateLabels}
      backHref="/client/invoices"
      backLabel="Back to invoices"
      actionsSlot={actionsSlot}
    />
  )
}

function formatMoney(value: number, currency: string): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency,
  }).format(value)
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
