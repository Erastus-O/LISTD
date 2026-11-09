import Link from 'next/link'
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  CreditCard,
  PoundSterling,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react'
import { eq } from 'drizzle-orm'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { profiles, withServiceRole } from '@/db'
import { requireRole } from '@/lib/dal'
import { isStripeConfigured } from '@/lib/billing/stripe'
import {
  getPaymentStatus,
  loadClerkEarnings,
  parseEarningsPage,
  type ClerkEarningsRow,
} from '@/lib/dashboard/clerk-earnings'
import {
  INSPECTION_TYPE_LABELS,
  type InspectionType,
} from '@/lib/pricing-matrix'
import { StripePayoutsCard } from '../settings/_components/stripe-payouts-card'

export const metadata = { title: 'Pro · Earnings' }
export const dynamic = 'force-dynamic'

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

/**
 * Clerk earnings (Lovable port of `ClerkEarnings.tsx`).
 *
 *   - 4 summary cards: total earned · this month · pending · last payout
 *   - paginated earnings history (20 per page)
 *   - bank-details footer (read-only stub for now — `clerk_bank_details`
 *     table not yet in Listd-NEXT schema)
 *
 * The history table includes jobs across the full earning pipeline
 * (`submitted` / `reviewed` / `signed` / `completed` / `paid`) so the clerk
 * can see what's owed even before payout. The Payment Status pill is the
 * authoritative signal: `paid` (clerk_payment_date set), `pending` (in a
 * payable terminal status with no payment date yet), or `processing`
 * (still in QA / sign-off).
 */
export default async function ClerkEarningsPage({ searchParams }: Props) {
  const session = await requireRole('clerk', 'trades', 'admin')
  const sp = await searchParams
  const pageNum = parseEarningsPage(sp)
  const data = await loadClerkEarnings(session.userId, pageNum)
  const { stats, rows, total, page, pageSize } = data

  // Real Stripe Connect payout status (replaces the old "bank details" stub —
  // payouts run through the clerk's connected account, not a stored bank row).
  const [connect] = await withServiceRole((tx) =>
    tx
      .select({
        status: profiles.stripeOnboardingStatus,
        payoutsEnabled: profiles.stripePayoutsEnabled,
      })
      .from(profiles)
      .where(eq(profiles.userId, session.userId))
      .limit(1)
  )

  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const pageHref = (n: number) => (n > 0 ? `/clerk/earnings?page=${n}` : '/clerk/earnings')

  return (
    <div className="w-full space-y-6 px-6 py-10">
      <div>
        <h1 className="font-display text-3xl text-foreground">Earnings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Track payouts, pending balance, and inspection history.
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <SummaryCard
          icon={PoundSterling}
          tone="primary"
          label="Total Earned"
          value={`£${stats.totalEarned.toFixed(2)}`}
        />
        <SummaryCard
          icon={TrendingUp}
          tone="primary"
          label="This Month"
          value={`£${stats.earnedThisMonth.toFixed(2)}`}
        />
        <SummaryCard
          icon={Clock}
          tone="warn"
          label="Pending Payment"
          value={`£${stats.pending.toFixed(2)}`}
        />
        <SummaryCard
          icon={CreditCard}
          tone="primary"
          label="Last Payout"
          value={
            stats.lastPayoutDate ? `£${stats.lastPayoutAmount.toFixed(2)}` : '—'
          }
          subtitle={
            stats.lastPayoutDate
              ? formatDate(stats.lastPayoutDate)
              : 'No payouts yet'
          }
        />
      </div>

      {/* Earnings history */}
      <Card>
        <CardContent className="space-y-4 p-6">
          <h2 className="text-base font-semibold">Earnings History</h2>
          {rows.length === 0 ? (
            <div className="space-y-2 py-12 text-center">
              <PoundSterling className="mx-auto h-10 w-10 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">No earnings yet</p>
              <p className="text-xs text-muted-foreground/60">
                Complete jobs to start earning
              </p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-border bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2.5 text-left font-medium">Date</th>
                      <th className="px-3 py-2.5 text-left font-medium">Job Ref</th>
                      <th className="px-3 py-2.5 text-left font-medium">Area</th>
                      <th className="px-3 py-2.5 text-left font-medium">
                        Service Type
                      </th>
                      <th className="px-3 py-2.5 text-right font-medium">
                        Clerk Pay
                      </th>
                      <th className="px-3 py-2.5 text-left font-medium">
                        Payment Status
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {rows.map((r) => (
                      <EarningsRow key={r.id} row={r} />
                    ))}
                  </tbody>
                </table>
              </div>

              {totalPages > 1 && (
                <div className="flex items-center justify-between border-t border-border pt-3 text-xs text-muted-foreground">
                  <span>
                    Page {page + 1} of {totalPages}
                  </span>
                  <div className="flex gap-2">
                    {page > 0 ? (
                      <Link
                        href={pageHref(page - 1)}
                        className="inline-flex h-8 items-center gap-1 rounded-md border border-border bg-background px-3 transition-colors hover:bg-muted"
                      >
                        <ChevronLeft className="h-3.5 w-3.5" />
                        Previous
                      </Link>
                    ) : (
                      <span className="inline-flex h-8 cursor-not-allowed items-center gap-1 rounded-md border border-border bg-muted/30 px-3 text-muted-foreground/50">
                        <ChevronLeft className="h-3.5 w-3.5" />
                        Previous
                      </span>
                    )}
                    {page + 1 < totalPages ? (
                      <Link
                        href={pageHref(page + 1)}
                        className="inline-flex h-8 items-center gap-1 rounded-md border border-border bg-background px-3 transition-colors hover:bg-muted"
                      >
                        Next
                        <ChevronRight className="h-3.5 w-3.5" />
                      </Link>
                    ) : (
                      <span className="inline-flex h-8 cursor-not-allowed items-center gap-1 rounded-md border border-border bg-muted/30 px-3 text-muted-foreground/50">
                        Next
                        <ChevronRight className="h-3.5 w-3.5" />
                      </span>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Payouts — real Stripe Connect status (set up / manage). Replaces the
          old bank-details stub: payouts go to the clerk's connected account. */}
      <StripePayoutsCard
        configured={isStripeConfigured()}
        status={connect?.status ?? 'none'}
        payoutsEnabled={Boolean(connect?.payoutsEnabled)}
      />
    </div>
  )
}

function EarningsRow({ row }: { row: ClerkEarningsRow }) {
  const pay = Number(row.payout ?? 0)
  const paymentStatus = getPaymentStatus(row)
  const district = row.property?.postcode?.split(' ')[0] ?? '—'
  const inspectionLabel =
    INSPECTION_TYPE_LABELS[row.inspectionType as InspectionType] ??
    row.inspectionType
  return (
    <tr className="hover:bg-muted/30">
      <td className="px-3 py-2.5 text-xs text-muted-foreground">
        {formatDate(row.scheduledDate)}
      </td>
      <td className="px-3 py-2.5">
        <Link
          href={`/clerk/jobs/${row.id}`}
          className="font-mono text-xs text-primary hover:underline"
        >
          {row.id.slice(0, 8)}
        </Link>
      </td>
      <td className="px-3 py-2.5 text-xs text-muted-foreground">
        {district}
        {row.property?.city ? `, ${row.property.city}` : ''}
      </td>
      <td className="px-3 py-2.5 text-xs">{inspectionLabel}</td>
      <td className="px-3 py-2.5 text-right text-sm font-semibold">
        £{pay.toFixed(2)}
      </td>
      <td className="px-3 py-2.5">
        <PaymentBadge status={paymentStatus} />
      </td>
    </tr>
  )
}

function PaymentBadge({
  status,
}: {
  status: 'paid' | 'pending' | 'processing'
}) {
  if (status === 'paid') {
    return (
      <Badge
        variant="outline"
        className="border-emerald-300/60 bg-emerald-500/10 text-[10px] text-emerald-700"
      >
        Paid
      </Badge>
    )
  }
  if (status === 'pending') {
    return (
      <Badge
        variant="outline"
        className="border-amber-500/30 bg-amber-500/10 text-[10px] text-amber-700"
      >
        Pending
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className="text-[10px] text-muted-foreground">
      Processing
    </Badge>
  )
}

const TONE_CLASSES: Record<'primary' | 'warn', string> = {
  primary: 'bg-primary/10 text-primary',
  warn: 'bg-amber-500/10 text-amber-700',
}

function SummaryCard({
  icon: Icon,
  tone,
  label,
  value,
  subtitle,
}: {
  icon: LucideIcon
  tone: keyof typeof TONE_CLASSES
  label: string
  value: string
  subtitle?: string
}) {
  return (
    <Card>
      <CardContent className="space-y-2 p-4">
        <div className="flex items-center gap-2">
          <span
            className={`flex h-7 w-7 items-center justify-center rounded-md ${TONE_CLASSES[tone]}`}
          >
            <Icon className="h-3.5 w-3.5" />
          </span>
          <span className="text-xs text-muted-foreground">{label}</span>
        </div>
        <p className="text-lg font-bold text-foreground">{value}</p>
        {subtitle && (
          <p className="text-[11px] text-muted-foreground">{subtitle}</p>
        )}
      </CardContent>
    </Card>
  )
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}
