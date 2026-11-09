import { notFound } from 'next/navigation'
import { InvoiceDetailView } from '@/components/billing/invoice-detail-view'
import { requireRole } from '@/lib/dal'
import {
  loadRecipientInvoice,
  loadTaxRateLabels,
} from '@/lib/billing/queries'

export const metadata = { title: 'Worker · Invoice detail' }
export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ id: string }> }

/**
 * Worker read-only invoice detail. Visibility is scoped to invoices that
 * have a line item linked to a job this worker created. Same notFound()
 * pattern as the client detail page — id enumeration shouldn't leak via
 * 403 vs 404.
 */
export default async function WorkerInvoiceDetailPage({ params }: Props) {
  const session = await requireRole('client', 'admin')
  const { id } = await params

  const inv = await loadRecipientInvoice(
    { kind: 'worker', workerId: session.userId },
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

  return (
    <InvoiceDetailView
      invoice={inv}
      rateLabels={rateLabels}
      backHref="/worker/invoices"
      backLabel="Back to invoices"
    />
  )
}
