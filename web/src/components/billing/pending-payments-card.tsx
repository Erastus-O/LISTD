import { CreditCard } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { loadOwnerPendingPayments } from '@/lib/dashboard/owner-pending-payments'
import { PayPublishButton } from './pay-publish-button'

const INSPECTION_LABEL: Record<string, string> = {
  new_inventory: 'New Inventory',
  check_in: 'Check-In',
  check_out: 'Check-Out',
  mid_term: 'Mid-Term',
  interim: 'Interim',
  clean_light: 'Light clean',
  clean_general: 'General clean',
  clean_deep: 'Deep clean',
}

/**
 * Owner-only "Awaiting your payment" surface. Lists draft jobs in the owner's
 * org that need payment to publish (chiefly workers' posts under the
 * owner-pays-via-link setting), each with a button that mints a fresh payment
 * link. Renders nothing for non-owners or when there's nothing pending — so
 * it's safe to drop unconditionally onto a page.
 */
export async function PendingPaymentsCard({ ownerUserId }: { ownerUserId: string }) {
  const pending = await loadOwnerPendingPayments(ownerUserId)
  if (pending.length === 0) return null

  return (
    <Card className="border-amber-300/60 bg-amber-50/40">
      <CardContent className="space-y-3 p-5">
        <div className="flex items-center gap-2">
          <CreditCard className="h-4 w-4 text-amber-700" />
          <h2 className="text-sm font-semibold text-foreground">
            Awaiting your payment
          </h2>
          <span className="rounded-full bg-amber-200/70 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
            {pending.length}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          These jobs stay unpublished until you pay. Paying mints a fresh secure
          link, so it works even if an earlier one expired.
        </p>
        <ul className="divide-y divide-amber-200/60">
          {pending.map((p) => (
            <li
              key={p.jobId}
              className="flex items-center gap-3 py-3 text-sm"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-foreground">
                  {p.address ?? '(no property)'}
                  {p.postcode && (
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      {p.postcode}
                    </span>
                  )}
                </p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {INSPECTION_LABEL[p.inspectionType] ?? p.inspectionType}
                  {p.posterName && ` · posted by ${p.posterName}`}
                </p>
              </div>
              <span className="shrink-0 text-sm font-semibold text-foreground">
                £{p.amountPounds.toFixed(0)}
              </span>
              <PayPublishButton jobId={p.jobId} />
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
