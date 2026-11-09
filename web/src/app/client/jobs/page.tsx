import Link from 'next/link'
import { ArrowRight, Plus, Sparkles } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { JobsFilterBar } from '@/components/dashboard/jobs-filter-bar'
import {
  JobsCalendar,
  type CalendarEvent,
} from '@/components/jobs/jobs-calendar'
import { parseMonthParam } from '@/components/jobs/calendar-month'
import { JobsViewToggle, type JobsView } from '@/components/jobs/view-toggle'
import { PendingPaymentsCard } from '@/components/billing/pending-payments-card'
import { requireSession } from '@/lib/dal'
import { loadClientJobs, parseJobsFilter } from '@/lib/dashboard/client-jobs'
import { StatusPill } from '@/components/listd/job-status'

export const metadata = { title: 'Client Jobs' }

const INSPECTION_LABEL: Record<string, string> = {
  new_inventory: 'New Inventory',
  check_in: 'Check-In',
  check_out: 'Check-Out',
  mid_term: 'Mid-Term',
  interim: 'Interim',
}

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

/**
 * Client Jobs list (M1 #14). All filters URL-driven so the page is shareable
 * and the heavy work stays server-side. Top 50 results; broader pagination
 * is a follow-up.
 */
export default async function ClientJobsListPage({ searchParams }: Props) {
  const session = await requireSession()
  const sp = await searchParams
  const filter = parseJobsFilter(sp)
  const { rows, total, filterOptions } = await loadClientJobs(
    session.userId,
    filter
  )

  const hasFilters = Object.keys(filter).length > 0
  const view: JobsView = sp.view === 'calendar' ? 'calendar' : 'list'
  // JobsCalendar handles its own month-navigation URLs (client-side via
  // usePathname/useSearchParams), so we only pass the active month.
  const cal = parseMonthParam(typeof sp.month === 'string' ? sp.month : undefined)

  return (
    <div className="w-full space-y-6 px-6 py-10">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl text-foreground">My jobs</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {total} {total === 1 ? 'job' : 'jobs'}
            {hasFilters ? ' matching the current filters' : ' total'}
            {view === 'list' && rows.length < total
              ? ` · showing the latest ${rows.length}`
              : ''}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <JobsViewToggle view={view} views={['list', 'calendar']} />
          <Link href="/book/clean">
            <Button size="sm" variant="outline" className="gap-1.5">
              <Sparkles className="h-3.5 w-3.5" />
              Book a clean
            </Button>
          </Link>
          <Link href="/book">
            <Button size="sm" className="gap-1.5">
              <Plus className="h-3.5 w-3.5" />
              Book inventory
            </Button>
          </Link>
        </div>
      </div>

      {/* Owner-only: worker posts (and any drafts) awaiting payment. Renders
          nothing for non-owners / when nothing is pending. */}
      <PendingPaymentsCard ownerUserId={session.userId} />

      <JobsFilterBar filterOptions={filterOptions} />

      {view === 'calendar' ? (
        <JobsCalendar
          year={cal.year}
          month={cal.month}
          events={rows.map((r): CalendarEvent => ({
            id: r.id,
            date: r.scheduledDate,
            status: r.status,
            href: `/client/jobs/${r.id}`,
            label: `${INSPECTION_LABEL[r.inspectionType] ?? r.inspectionType} · ${r.postcode?.split(/\s+/)[0] ?? '—'}`,
          }))}
        />
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            {hasFilters
              ? 'No jobs match these filters. Try clearing or broadening them.'
              : 'No jobs yet. Book your first inventory to get started.'}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y divide-border">
              {rows.map((job) => (
                <li key={job.id}>
                  <Link
                    href={`/client/jobs/${job.id}`}
                    className="flex items-center gap-4 px-5 py-4 text-sm transition-colors hover:bg-muted/30"
                  >
                    <DateBlock dateISO={job.scheduledDate} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate font-medium text-foreground">
                          {job.address ?? '(no property)'}
                        </p>
                        {job.postcode && (
                          <span className="text-xs text-muted-foreground">
                            {job.postcode}
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {INSPECTION_LABEL[job.inspectionType] ??
                          job.inspectionType}
                        {job.clerkName && ` · ${job.clerkName}`}
                        {job.createdByName &&
                          ` · booked by ${job.createdByName}`}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3 text-xs">
                      {job.quotedPrice && (
                        <span className="text-muted-foreground">
                          £{Number(job.quotedPrice).toFixed(0)}
                        </span>
                      )}
                      <StatusPill status={job.status} />
                      <ArrowRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function DateBlock({ dateISO }: { dateISO: string }) {
  const d = new Date(dateISO)
  const day = d.toLocaleDateString('en-GB', { day: 'numeric' })
  const mon = d.toLocaleDateString('en-GB', { month: 'short' })
  return (
    <div className="flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-lg bg-primary/10 text-primary">
      <span className="text-[10px] font-medium uppercase leading-none">
        {mon}
      </span>
      <span className="text-sm font-bold leading-none">{day}</span>
    </div>
  )
}
