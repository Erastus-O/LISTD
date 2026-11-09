import Link from 'next/link'
import {
  Calendar,
  ChevronRight,
  Download,
  FileText,
  MapPin,
  PoundSterling,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { requireRole } from '@/lib/dal'
import {
  INSPECTION_LABELS,
  STATUS_LABELS,
  formatGbp,
  loadClerkReports,
  parseReportsFilter,
  type ReportsRange,
} from '@/lib/dashboard/clerk-reports'

export const metadata = { title: 'Pro · Reports' }
export const dynamic = 'force-dynamic'

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

/**
 * Clerk Reports archive — the desktop counterpart of the Mobile PWA's
 * `/archive` surface. Lists every signed-off inspection the clerk has
 * a PDF for, with a postcode/address search and a coarse preset-range
 * filter (last 30 / 92 / 365 days / all).
 *
 * Card-driven layout matching the rest of the clerk dashboard (Jobs,
 * Earnings). PDF links open the stored `reportUrl` in a new tab; the
 * tap-and-mint signed-URL flow lives on the Mobile surface where the
 * link gets opened from a smaller-screen browser.
 */
export default async function ClerkReportsPage({ searchParams }: Props) {
  const session = await requireRole('clerk', 'trades', 'admin')
  const sp = await searchParams
  const filter = parseReportsFilter(sp)
  const rows = await loadClerkReports(session.userId, filter)

  return (
    <div className="w-full space-y-6 px-6 py-10">
      <header>
        <h1 className="font-display text-3xl text-foreground">Reports</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {rows.length} {rows.length === 1 ? 'report' : 'reports'} signed off
          {filter.range && filter.range !== 'all'
            ? ` in the ${rangeLabel(filter.range).toLowerCase()}`
            : ''}
          {filter.q ? ` matching "${filter.q}"` : ''}
        </p>
      </header>

      <RangeChips current={filter.range ?? 'all'} q={filter.q} />

      {rows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <FileText className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" />
            <p className="text-sm font-medium text-foreground">
              No reports yet
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {filter.range || filter.q
                ? 'Try widening the date range or clearing the search.'
                : 'Reports appear here once your submitted inspections are signed off.'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <li key={r.id} className="relative">
              <Card className="group transition-shadow hover:shadow-md">
                  <CardContent className="flex items-start gap-4 p-5">
                    <DateBadge dateISO={r.scheduledDate} />

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="secondary" className="capitalize">
                          {STATUS_LABELS[r.status] ?? r.status}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {INSPECTION_LABELS[r.inspectionType] ??
                            r.inspectionType}
                        </span>
                      </div>
                      <p className="mt-1.5 truncate text-base font-semibold text-foreground">
                        {r.property?.addressLine1 ?? '(address withheld)'}
                      </p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                        {r.property?.postcode && (
                          <span className="inline-flex items-center gap-1">
                            <MapPin className="h-3 w-3" />
                            {r.property.postcode}
                          </span>
                        )}
                        {r.property?.city && <span>{r.property.city}</span>}
                        <span className="inline-flex items-center gap-1">
                          <PoundSterling className="h-3 w-3" />
                          {formatGbp(r.clerkPayout)}
                        </span>
                      </p>
                    </div>

                    <div className="flex shrink-0 flex-col items-end gap-2">
                      {r.reportUrl ? (
                        <a
                          href={`/api/reports/${r.id}/view`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="relative z-10 inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-2.5 py-1.5 text-xs font-medium text-foreground shadow-sm transition-colors hover:bg-accent"
                        >
                          <Download className="h-3.5 w-3.5" />
                          PDF
                        </a>
                      ) : (
                        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                          No PDF
                        </span>
                      )}
                      <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                    </div>
                  </CardContent>
                  {/* Full-card click target → report detail. Sits beneath the
                      PDF link (z-10) so opening the PDF doesn't also navigate;
                      a sibling overlay anchor avoids nesting <a> in <a>. */}
                  <Link
                    href={`/clerk/reports/${r.id}`}
                    aria-label="Open report details"
                    className="absolute inset-0 rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="sr-only">Open report</span>
                  </Link>
                </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function rangeLabel(range: ReportsRange): string {
  return range === 'month'
    ? 'last 30 days'
    : range === 'quarter'
      ? 'last quarter'
      : range === 'year'
        ? 'last year'
        : 'all time'
}

/**
 * Preset date-range chips. URL-driven — clicking a chip navigates with
 * the `?range=` param set, no client state needed.
 */
function RangeChips({
  current,
  q,
}: {
  current: ReportsRange
  q: string | undefined
}) {
  const ranges: Array<{ key: ReportsRange; label: string }> = [
    { key: 'all', label: 'All time' },
    { key: 'year', label: 'Last year' },
    { key: 'quarter', label: 'Last 92 days' },
    { key: 'month', label: 'Last 30 days' },
  ]
  return (
    <div className="flex flex-wrap items-center gap-2">
      {ranges.map((r) => {
        const params = new URLSearchParams()
        if (r.key !== 'all') params.set('range', r.key)
        if (q) params.set('q', q)
        const href = `/clerk/reports${params.toString() ? `?${params}` : ''}`
        const active = current === r.key
        return (
          <Link
            key={r.key}
            href={href}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              active
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-input bg-background text-foreground hover:bg-accent'
            }`}
          >
            <Calendar className="h-3 w-3" />
            {r.label}
          </Link>
        )
      })}
    </div>
  )
}

function DateBadge({ dateISO }: { dateISO: string }) {
  const d = new Date(dateISO)
  if (!Number.isFinite(d.getTime())) {
    return <div className="h-12 w-12 shrink-0 rounded-md bg-muted" />
  }
  const day = d.toLocaleDateString('en-GB', { day: 'numeric' })
  const month = d.toLocaleDateString('en-GB', { month: 'short' })
  return (
    <div className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-md bg-secondary text-secondary-foreground">
      <span className="text-[10px] font-bold uppercase leading-none">
        {month}
      </span>
      <span className="text-sm font-bold leading-none">{day}</span>
    </div>
  )
}
