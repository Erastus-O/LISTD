import { Banknote } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { requireRole } from '@/lib/dal'
import { ReconcileForm } from './_components/reconcile-form'

export const metadata = { title: 'Admin · Bank reconciliation' }
export const dynamic = 'force-dynamic'

/**
 * Bank reconciliation page. Admin uploads a bank-statement CSV; the
 * server parses + auto-matches credit rows against outstanding invoices
 * and the page renders a confirm/edit table. Confirmed matches are
 * recorded as `bank_transfer` payments via the active billing provider.
 */
export default async function AdminReconcilePage() {
  await requireRole('admin')
  return (
    <div className="w-full space-y-6 px-6 py-10">
      <div className="flex items-center gap-2">
        <Banknote className="h-6 w-6 text-muted-foreground" />
        <div>
          <h1 className="font-display text-3xl text-foreground">
            Bank reconciliation
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Upload a bank statement CSV. We&rsquo;ll detect credits and
            propose matches against outstanding invoices. Review, edit,
            and confirm to record bank-transfer payments.
          </p>
        </div>
      </div>
      <Card>
        <CardContent className="p-6">
          <ReconcileForm />
        </CardContent>
      </Card>
    </div>
  )
}
