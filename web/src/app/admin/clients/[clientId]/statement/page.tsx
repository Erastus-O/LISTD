import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { StatementView } from '@/components/billing/statement-view'
import { requireRole } from '@/lib/dal'
import { loadClientStatement } from '@/lib/billing/statement'

export const metadata = { title: 'Admin · Statement of account' }
export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ clientId: string }> }

/**
 * Admin view of a client's statement. Reachable from the client detail
 * page header — gives the chasing-payment workflow a single screen
 * showing what's owed, ageing buckets, and per-document balance.
 */
export default async function AdminClientStatementPage({ params }: Props) {
  await requireRole('admin')
  const { clientId } = await params
  const statement = await loadClientStatement(clientId)
  if (!statement) notFound()

  return (
    <div className="w-full space-y-6 px-6 py-10">
      <Link
        href={`/admin/clients/${clientId}`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to client
      </Link>
      <StatementView statement={statement} invoiceBase="/admin/invoices" />
    </div>
  )
}
