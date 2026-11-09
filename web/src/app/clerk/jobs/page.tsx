import Link from 'next/link'
import { ArrowRight, Briefcase, Inbox } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { requireRole } from '@/lib/dal'
import {
  loadClerkJobs,
  parseClerkJobsFilter,
  STATUS_TONE,
  type ClerkJobRow,
} from '@/lib/dashboard/clerk-jobs'
import {
  INSPECTION_TYPE_LABELS,
  type InspectionType,
} from '@/lib/pricing-matrix'
import {
  JobsCalendar,
  type CalendarEvent,
} from '@/components/jobs/jobs-calendar'
import { parseMonthParam } from '@/components/jobs/calendar-month'
import { JobsViewToggle, type JobsView } from '@/components/jobs/view-toggle'
import { ClerkJobsFilterBar } from './_components/clerk-jobs-filter-bar'

export const metadata = { title: 'My Jobs' }
export const dynamic = 'force-dynamic'

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

const COMPLETABLE_STATUSES = new Set(['accepted', 'assigned', 'in_progress'])
const TERMINAL_STATUSES = new Set([
  'completed',
  'cancelled',
  'paid',
  'signed',
  'submitted',
  'reviewed',
])

/**
 * Clerk's "My Jobs" surface (Lovable port of `ClerkJobs.tsx` — My-Jobs tab).
 *
 * The Available tab Lovable rolled into this page lives at its own route in
 * Listd-NEXT (`/clerk/jobs/available`) — kept separate so the rich filter
 * bar + coverage matching don't have to share render space. A small
 * "View available jobs (N)" callout sits at the top of this page when the
 * queue isn't empty.
 *
 * The completion flow goes through `/clerk/jobs/[jobId]` rather than an
 * inline dialog, since the inspection→submit→sign path is multi-step and
 * the existing detail/submit-report routes are the canonical entry points.
 *
 * `force-dynamic` so the queue stays fresh — clerks rely on the latest
 * status when planning their day.
 */
export default async function ClerkJobsPage({ searchParams }: Props) {
  const session = await requireRole('clerk', 'trades', 'admin')
  const sp = await searchParams
  const filter = parseClerkJobsFilter(sp)
  const { rows, availableCount } = await loadClerkJobs(session.userId, filter)
  const view: JobsView = sp.view === 'calendar' ? 'calendar' : 'list'

  // JobsCalendar handles its own month-navigation URLs (client-side via
  // usePathname/useSearchParams), so we only pass the active month.
  const cal = parseMonthParam(typeof sp.month === 'string' ? sp.month : undefined)

  return (
    <div className="w-full space-y-6 px-6 py-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl text-foreground">My Jobs</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Inspections you&apos;ve accepted, completed, or are working on.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {availableCount > 0 && (
            <Link
              href="/clerk/jobs/available"
              className="inline-flex items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-4 py-2 text-sm font-medium text-primary transition-colors hover:bg-primary/10"
            >
              <Inbox className="h-4 w-4" />
              View available jobs
              <Badge
                variant="outline"
                className="border-primary/40 bg-primary/10 text-[10px] text-primary"
              >
                {availableCount}
              </Badge>
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          )}
          <JobsViewToggle view={view} views={['list', 'calendar']} />
        </div>
      </div>

      <ClerkJobsFilterBar />

      {view === 'calendar' ? (
        <JobsCalendar
          year={cal.year}
          month={cal.month}
          events={rows.map((r): CalendarEvent => ({
            id: r.id,
            date: r.scheduledDate,
            status: r.status,
            href: `/clerk/jobs/${r.id}`,
            label: `${INSPECTION_TYPE_LABELS[r.inspectionType as InspectionType] ?? r.inspectionType} · ${r.property?.postcode?.split(/\s+/)[0] ?? '—'}`,
          }))}
        />
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="space-y-2 py-12 text-center">
            <Briefcase className="mx-auto h-10 w-10 text-muted-foreground" />
            <h3 className="text-base font-medium text-foreground">
              No jobs found
            </h3>
            <p className="text-sm text-muted-foreground">
              {availableCount > 0
                ? 'Nothing on your roster matches these filters.'
                : 'Once you accept jobs from the available queue, they appear here.'}
            </p>
            {availableCount > 0 && (
              <Link
                href="/clerk/jobs/available"
                className="mx-auto mt-2 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
              >
                Browse available
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {rows.map((job) => (
            <JobRow key={job.id} job={job} />
          ))}
        </div>
      )}
    </div>
  )
}

function JobRow({ job }: { job: ClerkJobRow }) {
  const overdue = isOverdue(job.scheduledDate, job.status)
  const completable = COMPLETABLE_STATUSES.has(job.status)
  const inspectionLabel =
    INSPECTION_TYPE_LABELS[job.inspectionType as InspectionType] ??
    job.inspectionType
  const tone = STATUS_TONE[job.status] ?? 'outline'

  return (
    <Link
      href={`/clerk/jobs/${job.id}`}
      className="block transition-shadow hover:shadow-sm"
    >
      <Card>
        <CardContent className="flex items-center justify-between gap-3 p-4">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-foreground">
              {job.property?.addressLine1 ?? 'Address pending'}
              {job.property?.postcode ? `, ${job.property.postcode}` : ''}
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {inspectionLabel} · {formatDate(job.scheduledDate)}
              {job.preferredTimeSlot ? ` · ${job.preferredTimeSlot}` : ''}
            </p>
            {job.createdByName && (
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                Client: {job.createdByName}
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {completable && (
              <span className="hidden items-center gap-1 text-[11px] font-medium text-primary sm:inline-flex">
                Continue
                <ArrowRight className="h-3 w-3" />
              </span>
            )}
            {overdue && (
              <Badge variant="destructive" className="text-[10px]">
                Overdue
              </Badge>
            )}
            <Badge variant={tone} className="text-[10px] capitalize">
              {job.status.replace(/_/g, ' ')}
            </Badge>
          </div>
        </CardContent>
      </Card>
    </Link>
  )
}

function isOverdue(scheduledYmd: string, status: string): boolean {
  if (TERMINAL_STATUSES.has(status)) return false
  const endOfDay = new Date(`${scheduledYmd}T23:59:59`)
  return endOfDay.getTime() < Date.now()
}

function formatDate(ymd: string): string {
  const d = new Date(ymd)
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

