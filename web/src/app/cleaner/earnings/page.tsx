import { PoundSterling } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { requireRole } from '@/lib/dal'
import { loadCleanerJobs } from '@/lib/dashboard/cleaner-jobs'

export const metadata = { title: 'Cleaner · Earnings' }
export const dynamic = 'force-dynamic'

export default async function CleanerEarningsPage() {
  const session = await requireRole('cleaner', 'admin')
  const rows = await loadCleanerJobs(session.userId)

  const paid = rows.filter((r) => r.status === 'paid')
  const completed = rows.filter((r) => r.status === 'completed')
  const pending = rows.filter((r) => r.status === 'accepted' || r.status === 'in_progress')

  const sum = (list: typeof rows) =>
    list.reduce(
      (t, r) => t + Number(r.cleanerFinalPayout ?? r.cleanerPayout ?? 0),
      0
    )
  const paidTotal = sum(paid)
  const awaitingPayment = sum(completed)
  const upcoming = sum(pending)

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-6 py-10">
      <div>
        <h1 className="font-display text-3xl text-foreground">Earnings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          What you&rsquo;ve earned from cleans.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Paid" value={paidTotal} />
        <Stat label="Awaiting payment" value={awaitingPayment} />
        <Stat label="Upcoming (accepted)" value={upcoming} />
      </div>

      {rows.length === 0 && (
        <Card>
          <CardContent className="p-10 text-center text-sm text-muted-foreground">
            No earnings yet: accept and complete a clean to start earning.
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="p-5">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <p className="mt-1 flex items-center gap-1 font-semibold text-2xl text-foreground">
          <PoundSterling className="h-5 w-5 text-muted-foreground" />
          {value.toFixed(2)}
        </p>
      </CardContent>
    </Card>
  )
}
