import Link from 'next/link'
import { desc, eq } from 'drizzle-orm'
import { Briefcase, PlusCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { db, jobs, properties } from '@/db'
import { requireRole } from '@/lib/dal'
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
import { StatusPill } from '@/components/listd/job-status'

export const metadata = { title: 'Worker · My Jobs' }
export const dynamic = 'force-dynamic'

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

/**
 * Worker's own jobs — scoped to `created_by_user_id = caller`. Cross-links
 * to `/client/jobs/[id]` for the detail surface (which RLS already allows
 * since the worker is the `client_id` of their own bookings).
 */
export default async function WorkerJobsPage({ searchParams }: Props) {
  const session = await requireRole('client', 'admin')
  const sp = await searchParams
  const view: JobsView = sp.view === 'calendar' ? 'calendar' : 'list'
  // JobsCalendar handles its own month-navigation URLs client-side.
  const cal = parseMonthParam(typeof sp.month === 'string' ? sp.month : undefined)

  const rows = await db
    .select({
      id: jobs.id,
      status: jobs.status,
      inspectionType: jobs.inspectionType,
      scheduledDate: jobs.scheduledDate,
      quotedPrice: jobs.quotedPrice,
      addressLine1: properties.addressLine1,
      city: properties.city,
      postcode: properties.postcode,
    })
    .from(jobs)
    .leftJoin(properties, eq(properties.id, jobs.propertyId))
    .where(eq(jobs.createdByUserId, session.userId))
    .orderBy(desc(jobs.scheduledDate))
    .limit(100)

  return (
    <div className="w-full space-y-6 px-6 py-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Briefcase className="h-6 w-6 text-muted-foreground" />
          <div>
            <h1 className="font-display text-3xl text-foreground">My jobs</h1>
            <p className="mt-1 text-xs text-muted-foreground">
              {rows.length} {rows.length === 1 ? 'job' : 'jobs'} you&apos;ve
              posted
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <JobsViewToggle view={view} views={['list', 'calendar']} />
          <Button asChild size="sm" className="gap-1.5">
            <Link href="/book">
              <PlusCircle className="h-4 w-4" />
              Post a job
            </Link>
          </Button>
        </div>
      </div>

      {view === 'calendar' ? (
        <JobsCalendar
          year={cal.year}
          month={cal.month}
          events={rows.map((r): CalendarEvent => ({
            id: r.id,
            date: r.scheduledDate,
            status: r.status,
            href: `/client/jobs/${r.id}`,
            label: `${INSPECTION_TYPE_LABELS[r.inspectionType as InspectionType] ?? r.inspectionType} · ${r.postcode?.split(/\s+/)[0] ?? '—'}`,
          }))}
        />
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No jobs yet. Tap{' '}
            <Link href="/book" className="text-primary hover:underline">
              Post a job
            </Link>{' '}
            to get started.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5 text-left font-medium">Ref</th>
                    <th className="px-4 py-2.5 text-left font-medium">
                      Property
                    </th>
                    <th className="px-4 py-2.5 text-left font-medium">Type</th>
                    <th className="px-4 py-2.5 text-left font-medium">
                      Status
                    </th>
                    <th className="px-4 py-2.5 text-left font-medium">Date</th>
                    <th className="px-4 py-2.5 text-right font-medium">
                      Quoted
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((j) => (
                    <tr key={j.id} className="hover:bg-muted/30">
                      <td className="px-4 py-2.5">
                        <Link
                          href={`/client/jobs/${j.id}`}
                          className="font-mono text-xs text-primary hover:underline"
                        >
                          {j.id.slice(0, 8)}
                        </Link>
                      </td>
                      <td className="max-w-[260px] truncate px-4 py-2.5 text-xs">
                        {j.addressLine1
                          ? `${j.addressLine1}${j.postcode ? ', ' + j.postcode : ''}`
                          : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-xs">
                        {INSPECTION_TYPE_LABELS[
                          j.inspectionType as InspectionType
                        ] ?? j.inspectionType}
                      </td>
                      <td className="px-4 py-2.5">
                        <StatusPill status={j.status} />
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-xs">
                        {j.scheduledDate}
                      </td>
                      <td className="px-4 py-2.5 text-right text-xs">
                        {j.quotedPrice
                          ? `£${Number(j.quotedPrice).toFixed(2)}`
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
