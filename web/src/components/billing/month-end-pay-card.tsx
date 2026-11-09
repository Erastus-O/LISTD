import { CalendarClock } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import type { DeferredBalance } from '@/lib/billing/promo-debt'

/**
 * Worker-side "due at month end" banner (0035): payouts accrued on
 * monthly-account (invoice_later promo) jobs they've delivered. These jobs
 * take no escrow at booking, so the payout settles in the monthly run
 * instead of on QA release. Renders nothing at £0. Shared by the clerk and
 * cleaner dashboards.
 */
export function MonthEndPayCard({ due }: { due: DeferredBalance }) {
  if (due.totalPounds <= 0) return null
  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <CalendarClock className="h-5 w-5 text-primary" />
          </span>
          <div>
            <p className="text-sm font-semibold text-foreground">
              Due at month end
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {due.jobCount} job{due.jobCount === 1 ? '' : 's'} completed for
              monthly-account clients. These are paid in the month-end run
              rather than on report approval.
            </p>
          </div>
        </div>
        <p className="font-semibold text-2xl text-foreground">
          £
          {Number.isInteger(due.totalPounds)
            ? due.totalPounds
            : due.totalPounds.toFixed(2)}
        </p>
      </CardContent>
    </Card>
  )
}
