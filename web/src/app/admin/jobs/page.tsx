import Link from 'next/link'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { requireRole } from '@/lib/dal'
import {
  loadAdminJobsList,
  parseAdminJobsFilter,
  STATUS_BADGE_TONE,
  type AdminJobListRow,
} from '@/lib/dashboard/admin-jobs'
import { geocodePostcodes } from '@/lib/geocode'
import { formatJobReference } from '@/lib/jobs/reference'
import { effectiveClerkPayout } from '@/lib/payout'
import { INSPECTION_TYPE_LABELS } from '@/lib/pricing-matrix'
import {
  JobsCalendar,
  type CalendarEvent,
} from '@/components/jobs/jobs-calendar'
import { parseMonthParam } from '@/components/jobs/calendar-month'
import { JobsMapLoader } from '@/components/jobs/jobs-map-loader'
import { RecomputePayoutsButton } from './_components/recompute-payouts-button'
import { JobsViewToggle, type JobsView } from '@/components/jobs/view-toggle'
import { AdminJobsFilterBar } from './_components/admin-jobs-filter-bar'

export const metadata = { title: 'Admin · Jobs' }

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

/**
 * Admin Jobs list (S6c of the Lovable port). URL-driven filters + pagination
 * (page=N), server-rendered. Click-through to the detail page where
 * EditablePrice lands and the pricing-override audit trail is written.
 *
 * Out of scope this round: CSV export (deferred to next polish session;
 * the email-logs export pattern already exists at
 * `/api/admin/email-logs/export` and can be cloned).
 */
export default async function AdminJobsPage({ searchParams }: Props) {
  await requireRole('admin')
  const sp = await searchParams
  const filter = parseAdminJobsFilter(sp)
  const view: JobsView =
    sp.view === 'map' ? 'map' : sp.view === 'calendar' ? 'calendar' : 'list'
  // Map + Calendar both render the full filtered set in one shot — paging
  // is meaningless on either, so server-side cap kicks in (MAP_VIEW_MAX).
  const { rows, total, page, pageSize } = await loadAdminJobsList(
    filter,
    view === 'list' ? {} : { pageSize: 500 }
  )

  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const baseQs = new URLSearchParams()
  if (filter.q) baseQs.set('q', filter.q)
  if (filter.status) baseQs.set('status', filter.status)
  if (filter.type) baseQs.set('type', filter.type)
  if (filter.district) baseQs.set('district', filter.district)

  const pageHref = (n: number) => {
    const next = new URLSearchParams(baseQs.toString())
    if (n > 0) next.set('page', String(n))
    const qs = next.toString()
    return qs ? `/admin/jobs?${qs}` : '/admin/jobs'
  }

  /** URL for "Filter to <district>" — flips back to list view and
   *  replaces any existing district filter with the clicked one. */
  const districtFilterHref = (district: string): string => {
    const next = new URLSearchParams(baseQs.toString())
    next.set('district', district)
    next.delete('page')
    return `/admin/jobs?${next.toString()}`
  }

  // Calendar wiring — JobsCalendar builds prev/next/Today URLs itself
  // from `usePathname()` + `useSearchParams()`, so this server component
  // only needs to tell it which month to render.
  const cal = parseMonthParam(typeof sp.month === 'string' ? sp.month : undefined)

  return (
    <div className="w-full space-y-6 px-6 py-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl text-foreground">Jobs</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {total} {total === 1 ? 'job' : 'jobs'}
            {view === 'list' && totalPages > 1
              ? ` · page ${page + 1} of ${totalPages}`
              : ''}
            {(view === 'map' || view === 'calendar') && total > 500
              ? ' · showing first 500'
              : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <RecomputePayoutsButton />
          <JobsViewToggle view={view} />
        </div>
      </div>

      <AdminJobsFilterBar />

      {view === 'map' ? (
        <AdminJobsMap
          rows={rows}
          activeDistrict={filter.district ?? null}
          districtFilterHref={districtFilterHref}
        />
      ) : view === 'calendar' ? (
        <JobsCalendar
          year={cal.year}
          month={cal.month}
          events={rows.map((r): CalendarEvent => ({
            id: r.id,
            date: r.scheduledDate,
            status: r.status,
            href: `/admin/jobs/${r.id}`,
            label: `${INSPECTION_TYPE_LABELS[r.inspectionType] ?? r.inspectionType} · ${r.property?.postcode?.split(/\s+/)[0] ?? '—'}`,
            hint: r.client?.companyName ?? r.client?.fullName ?? undefined,
          }))}
        />
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No jobs match this filter.
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
                    <th className="px-4 py-2.5 text-left font-medium">Property</th>
                    <th className="px-4 py-2.5 text-left font-medium">Client</th>
                    <th className="px-4 py-2.5 text-left font-medium">Type</th>
                    <th className="px-4 py-2.5 text-left font-medium">Pro</th>
                    <th className="px-4 py-2.5 text-left font-medium">Status</th>
                    <th className="px-4 py-2.5 text-left font-medium">Date</th>
                    <th className="px-4 py-2.5 text-right font-medium">Price</th>
                    <th className="px-4 py-2.5 text-right font-medium">Pro pay</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((j) => (
                    <JobRow key={j.id} job={j} />
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {view === 'list' && totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
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
    </div>
  )
}

function JobRow({ job }: { job: AdminJobListRow }) {
  const ref = formatJobReference({
    jobId: job.id,
    addressLine1: job.property?.addressLine1,
    postcode: job.property?.postcode,
  })
  const clientName = job.client?.companyName ?? job.client?.fullName ?? '—'
  const clerkPay = effectiveClerkPayout(job.clerkFinalPayout, job.clerkPayout)
  return (
    <tr className="hover:bg-muted/30">
      <td className="px-4 py-2.5">
        <Link
          href={`/admin/jobs/${job.id}`}
          className="font-mono text-xs text-primary hover:underline"
        >
          {ref}
        </Link>
      </td>
      <td className="max-w-[220px] px-4 py-2.5">
        <Link href={`/admin/jobs/${job.id}`} className="block hover:underline">
          <div className="truncate text-sm font-medium">
            {job.property?.addressLine1 ?? '—'}
          </div>
          <div className="text-[10px] text-muted-foreground">
            {[job.property?.city, job.property?.postcode]
              .filter(Boolean)
              .join(' · ') || '—'}
          </div>
        </Link>
      </td>
      <td className="max-w-[140px] truncate px-4 py-2.5 text-xs">{clientName}</td>
      <td className="px-4 py-2.5 text-xs">
        {INSPECTION_TYPE_LABELS[job.inspectionType] ?? job.inspectionType}
      </td>
      <td className="px-4 py-2.5 text-xs">
        {job.clerk?.fullName ?? (
          <span className="text-muted-foreground">Unassigned</span>
        )}
      </td>
      <td className="px-4 py-2.5">
        <Badge variant={STATUS_BADGE_TONE[job.status]}>
          {job.status.replace(/_/g, ' ')}
        </Badge>
      </td>
      <td className="whitespace-nowrap px-4 py-2.5 text-xs">{job.scheduledDate}</td>
      <td className="px-4 py-2.5 text-right text-xs">
        {job.quotedPrice ? `£${Number(job.quotedPrice).toFixed(2)}` : '—'}
      </td>
      <td className="px-4 py-2.5 text-right text-xs">
        {clerkPay ? `£${Number(clerkPay).toFixed(2)}` : '—'}
      </td>
    </tr>
  )
}

/**
 * Geocodes the filtered rows' postcodes (cached for 30 days in Upstash)
 * and renders the Leaflet map. Rows whose postcode doesn't geocode are
 * silently dropped from the map but still show in the list view.
 *
 * Each pin's popup carries a "Filter to <district>" secondary action
 * that flips back to list view with `?district=<outward-code>` set —
 * unless the list is already filtered to that district, in which case
 * the action is omitted (it'd be a no-op).
 */
async function AdminJobsMap({
  rows,
  activeDistrict,
  districtFilterHref,
}: {
  rows: AdminJobListRow[]
  activeDistrict: string | null
  districtFilterHref: (district: string) => string
}) {
  const postcodes = rows
    .map((r) => r.property?.postcode ?? '')
    .filter(Boolean)
  const coords = await geocodePostcodes(postcodes)

  const pins = rows
    .map((r) => {
      const pc = r.property?.postcode ?? ''
      const latlng = pc
        ? coords.get(pc.toUpperCase().replace(/\s+/g, ' ').trim())
        : null
      if (!latlng) return null
      const ref = formatJobReference({
        jobId: r.id,
        addressLine1: r.property?.addressLine1,
        postcode: r.property?.postcode,
      })
      const price = r.quotedPrice ? `£${Number(r.quotedPrice).toFixed(2)}` : null
      const district = pc.split(/\s+/)[0]?.toUpperCase() ?? ''
      const showFilter =
        district.length > 0 && district !== (activeDistrict ?? '')
      return {
        id: r.id,
        lat: latlng.lat,
        lng: latlng.lng,
        title: `${INSPECTION_TYPE_LABELS[r.inspectionType] ?? r.inspectionType} · ${ref}`,
        subtitle:
          [r.property?.addressLine1, r.property?.city, r.property?.postcode]
            .filter(Boolean)
            .join(', ') || undefined,
        meta: [price, r.scheduledDate].filter(Boolean).join(' · ') || undefined,
        href: `/admin/jobs/${r.id}`,
        secondaryAction: showFilter
          ? {
              label: `Filter to ${district}`,
              href: districtFilterHref(district),
            }
          : undefined,
      }
    })
    .filter((p): p is NonNullable<typeof p> => p !== null)

  const unmappedCount = rows.length - pins.length
  return (
    <div className="space-y-2">
      <JobsMapLoader
        pins={pins}
        emptyLabel="None of the matching jobs have a recognised postcode."
      />
      {unmappedCount > 0 && (
        <p className="text-[11px] text-muted-foreground">
          {unmappedCount} job{unmappedCount === 1 ? '' : 's'} not shown : postcode
          missing or not recognised by postcodes.io. Switch to list view to see
          them.
        </p>
      )}
    </div>
  )
}
