import Link from 'next/link'
import { CalendarClock } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { loadClientDeferredBalance } from '@/lib/billing/promo-debt'

/**
 * "Monthly account" card for the client dashboard (0035): the running
 * balance of invoice-later promo bookings not yet swept into a month-end
 * invoice. Renders nothing when the balance is zero — most clients never
 * see this. Server component; defensive loader (pre-migration → 0).
 */
export async function DeferredBalanceCard({
  clientUserId,
}: {
  clientUserId: string
}) {
  const balance = await loadClientDeferredBalance(clientUserId)
  if (balance.totalPounds <= 0) return null

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <CalendarClock className="h-5 w-5 text-primary" />
          </span>
          <div>
            <p className="text-sm font-semibold text-foreground">
              Monthly account balance
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {balance.jobCount} promo booking
              {balance.jobCount === 1 ? '' : 's'} posted on your monthly
              account. You&rsquo;ll receive one consolidated invoice with a
              secure payment link at the start of next month.
            </p>
          </div>
        </div>
        <div className="text-right">
          <p className="font-semibold text-2xl text-foreground">
            £
            {Number.isInteger(balance.totalPounds)
              ? balance.totalPounds
              : balance.totalPounds.toFixed(2)}
          </p>
          <Link
            href="/client/statement"
            className="text-xs font-medium text-primary hover:underline"
          >
            View statement
          </Link>
        </div>
      </CardContent>
    </Card>
  )
}
