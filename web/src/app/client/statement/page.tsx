import { notFound } from 'next/navigation'
import { StatementView } from '@/components/billing/statement-view'
import { requireRole } from '@/lib/dal'
import { loadClientStatement } from '@/lib/billing/statement'

export const metadata = { title: 'Client · Statement of account' }
export const dynamic = 'force-dynamic'

/**
 * Client view of their own statement of account. Same renderer as the
 * admin variant; the only difference is scope (server already guarantees
 * the loader is called with `session.userId`).
 */
export default async function ClientStatementPage() {
  const session = await requireRole('client')
  const statement = await loadClientStatement(session.userId)
  if (!statement) notFound()

  return (
    <div className="w-full space-y-6 px-6 py-10">
      <StatementView statement={statement} invoiceBase="/client/invoices" />
    </div>
  )
}
