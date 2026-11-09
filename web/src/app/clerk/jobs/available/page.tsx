import Link from 'next/link'
import {
  AlertCircle,
  Calendar as CalendarIcon,
  Clock,
  Home,
  MapPin,
  PoundSterling,
  RefreshCw,
  Search,
  Users,
  Zap,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { requireSession } from '@/lib/dal'
import {
  loadAvailableJobs,
  parseAvailableJobsFilter,
  type AvailableJobRow,
} from '@/lib/dashboard/clerk-available-jobs'
import { geocodePostcodes } from '@/lib/geocode'
import { formatJobReference } from '@/lib/jobs/reference'
import {
  FURNISHED_STATUS_LABELS,
  TIER_LABELS,
  type FurnishedStatus,
  type ServiceTier,
} from '@/lib/pricing-matrix'
import {
  jobServiceLabels,
  jobServiceSummary,
  tenantAppointmentServices,
} from '@/lib/jobs/services'
import { dwellingLabel } from '@/lib/property/dwelling'
import { maskedLocation } from '@/lib/property/address'
import { JobsMapLoader } from '@/components/jobs/jobs-map-loader'
import { JobsViewToggle } from '@/components/jobs/view-toggle'
import { AvailableJobsFilterBar } from './_components/available-jobs-filter-bar'
import { JobDetailsModal } from './_components/job-details-modal'

export const metadata = { title: 'Pro · Available Jobs' }
export const dynamic = 'force-dynamic'

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

const STATUS_COPY: Record<
  string,
  { title: string; body: string; cta: { href: string; label: string } | null }
> = {
  unverified: {
    title: 'Complete verification to see jobs',
    body: 'You need to finish your 5-step clerk verification before jobs in your area show up here.',
    cta: { href: '/onboarding/clerk', label: 'Start verification' },
  },
  pending_verification: {
    title: 'Your application is under review',
    body: "We typically review submissions within 24 hours. You'll get an email and an in-app notification as soon as a decision is made.",
    cta: null,
  },
  rejected: {
    title: 'A few changes are needed',
    body: 'Your submission was returned with changes requested. Please update the affected documents and resubmit.',
    cta: { href: '/onboarding/clerk', label: 'Update application' },
  },
  suspended: {
    title: 'Marketplace access suspended',
    body: 'A document on file has expired. Re-upload an in-date copy to restore access.',
    cta: { href: '/onboarding/clerk', label: 'Re-upload documents' },
  },
}

/**
 * Available Jobs queue (Lovable port of `ClerkAvailableJobs`).
 *
 * **Verification gate (M1 #8)** stays at the top: only `verified` clerks
 * (and admins for QA/impersonation) can see the feed. Pre-verified clerks
 * see the appropriate status copy + CTA into onboarding.
 *
 * Once past the gate: server-rendered card grid with URL-driven filters
 * (type / postcode / date range / sort). The card is a summary surface
 * — clicking "View" opens the [JobDetailsModal](./_components/job-details-modal.tsx)
 * with the full grid + Special Notes; Accept Job there POSTs to
 * [/api/clerk/jobs/[id]/accept](../../api/clerk/jobs/[jobId]/accept/route.ts).
 *
 * Coverage filtering is enforced server-side: clerks only see published jobs
 * whose property postcode-district prefix matches one of their
 * `coverage_areas`. Service-type filter honours their `service_types_offered`
 * whitelist when no explicit filter is set.
 *
 * `force-dynamic` so the queue is fresh on every visit — published jobs
 * disappear quickly when claimed.
 */
export default async function ClerkAvailableJobsPage({ searchParams }: Props) {
  const session = await requireSession()
  const status = session.profile?.verificationStatus ?? 'unverified'

  if (status !== 'verified' && !session.roles.includes('admin')) {
    const copy = STATUS_COPY[status] ?? STATUS_COPY.unverified
    return (
      <div className="mx-auto max-w-2xl px-6 py-16">
        <Card>
          <CardContent className="space-y-4 p-8 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <AlertCircle className="h-6 w-6 text-muted-foreground" />
            </div>
            <h1 className="text-xl font-semibold text-foreground">
              {copy.title}
            </h1>
            <p className="text-sm text-muted-foreground">{copy.body}</p>
            {copy.cta && (
              <Link
                href={copy.cta.href}
                className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
              >
                {copy.cta.label}
              </Link>
            )}
          </CardContent>
        </Card>
      </div>
    )
  }

  const sp = await searchParams
  const filter = parseAvailableJobsFilter(sp)
  const data = await loadAvailableJobs(session.userId, filter)
  const {
    rows,
    postcodeDistricts,
    coverageAreas,
    serviceTypes,
    totalUnclaimed,
    serviceTypeMatched,
    unmatchedDistricts,
  } = data
  const view: 'list' | 'map' = sp.view === 'map' ? 'map' : 'list'
  const activeDistrict = filter.postcode?.toUpperCase() ?? null

  /** URL for "Filter to <district>" on a pin — flips to list view and
   *  overrides `postcode` (the feed's built-in district filter) while
   *  keeping any existing type/date/sort narrowing. */
  const districtFilterHref = (district: string): string => {
    const next = new URLSearchParams()
    if (filter.type) next.set('type', filter.type)
    if (filter.sort) next.set('sort', filter.sort)
    if (filter.from) next.set('from', filter.from)
    if (filter.to) next.set('to', filter.to)
    next.set('postcode', district)
    return `/clerk/jobs/available?${next.toString()}`
  }

  return (
    <div className="w-full space-y-6 px-6 py-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl text-foreground">Available Jobs</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Browse and accept jobs in your coverage area
          </p>
        </div>
        <JobsViewToggle view={view} views={['list', 'map']} />
      </div>

      <AvailableJobsFilterBar postcodeDistricts={postcodeDistricts} />

      {view === 'map' ? (
        <AvailableJobsMap
          rows={rows}
          activeDistrict={activeDistrict}
          districtFilterHref={districtFilterHref}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          coverageAreas={coverageAreas}
          serviceTypes={serviceTypes}
          totalUnclaimed={totalUnclaimed}
          serviceTypeMatched={serviceTypeMatched}
          unmatchedDistricts={unmatchedDistricts}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((job) => (
            <JobCard key={job.id} job={job} />
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Map version of the available-jobs feed. Same set of rows the list view
 * sees (already filtered by coverage + service types + URL filters), each
 * pin showing service type + ref + scheduled date + clerk pay. The
 * available-jobs feed deliberately hides addressLine1 pre-accept, so the
 * popup uses the postcode area as the location label.
 *
 * Each pin's popup carries a "Filter to <district>" secondary action
 * that flips back to list view with `?postcode=<outward-code>` set —
 * unless the feed is already filtered to that district.
 */
async function AvailableJobsMap({
  rows,
  activeDistrict,
  districtFilterHref,
}: {
  rows: AvailableJobRow[]
  activeDistrict: string | null
  districtFilterHref: (district: string) => string
}) {
  const postcodes = rows
    .map((r) => r.property.postcode ?? '')
    .filter(Boolean)
  const coords = await geocodePostcodes(postcodes)

  const pins = rows
    .map((r) => {
      const pc = r.property.postcode ?? ''
      const latlng = pc
        ? coords.get(pc.toUpperCase().replace(/\s+/g, ' ').trim())
        : null
      if (!latlng) return null
      const ref = formatJobReference({
        jobId: r.id,
        postcode: r.property.postcode,
      })
      const payout = Number(r.clerkPayout ?? 0)
      const meta = [
        payout > 0 ? `£${payout.toFixed(2)}` : null,
        r.scheduledDate,
      ]
        .filter(Boolean)
        .join(' · ')
      const district = pc.split(/\s+/)[0]?.toUpperCase() ?? ''
      const showFilter =
        district.length > 0 && district !== (activeDistrict ?? '')
      return {
        id: r.id,
        lat: latlng.lat,
        lng: latlng.lng,
        title: `${jobServiceSummary(r)} · ${ref}`,
        // District, not the full postcode: the map is a pre-accept surface
        // and a pin plus an exact postcode is an address.
        subtitle: maskedLocation(r.property) || undefined,
        meta: meta || undefined,
        // Detail link is intentionally the same as the list-view "View"
        // button — pre-accept the modal opens; post-accept it's /jobs/<id>.
        href: `/clerk/jobs/${r.id}`,
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
        emptyLabel="No available jobs with a recognised postcode."
      />
      {unmappedCount > 0 && (
        <p className="text-[11px] text-muted-foreground">
          {unmappedCount} job{unmappedCount === 1 ? '' : 's'} not shown : postcode
          missing or not recognised. Switch to list view to see them.
        </p>
      )}
    </div>
  )
}

function EmptyState({
  coverageAreas,
  serviceTypes,
  totalUnclaimed,
  serviceTypeMatched,
  unmatchedDistricts,
}: {
  coverageAreas: string[]
  serviceTypes: string[]
  totalUnclaimed: number
  serviceTypeMatched: number
  unmatchedDistricts: string[]
}) {
  // Diagnose why the queue is empty for this clerk.
  const noCoverage = coverageAreas.length === 0
  const filteredOutByService =
    serviceTypes.length > 0 && serviceTypeMatched < totalUnclaimed
  const filteredOutByCoverage =
    !noCoverage && serviceTypeMatched > 0 // pool exists, just not in their districts

  return (
    <Card>
      <CardContent className="space-y-4 py-12 text-center">
        <Search className="mx-auto h-10 w-10 text-muted-foreground" />
        <h3 className="text-base font-medium text-foreground">
          No available jobs
        </h3>

        {totalUnclaimed === 0 ? (
          <p className="mx-auto max-w-md text-sm text-muted-foreground">
            The queue is empty across the whole platform right now. New jobs
            cycle quickly: check back shortly.
          </p>
        ) : noCoverage ? (
          <p className="mx-auto max-w-md text-sm text-muted-foreground">
            <strong className="text-foreground">{totalUnclaimed}</strong>{' '}
            {totalUnclaimed === 1 ? 'job is' : 'jobs are'} available, but you
            haven’t set any coverage areas yet: set coverage in your settings
            to start matching.
          </p>
        ) : filteredOutByCoverage ? (
          <div className="mx-auto max-w-md space-y-2 text-sm text-muted-foreground">
            <p>
              <strong className="text-foreground">{serviceTypeMatched}</strong>{' '}
              {serviceTypeMatched === 1 ? 'job is' : 'jobs are'} available for
              your service types but none are in your coverage area.
            </p>
            <p className="text-xs">
              Your coverage:{' '}
              <span className="font-mono text-foreground">
                {coverageAreas.join(' · ')}
              </span>
            </p>
            {unmatchedDistricts.length > 0 && (
              <p className="text-xs">
                Districts with open jobs:{' '}
                <span className="font-mono text-foreground">
                  {unmatchedDistricts.slice(0, 8).join(' · ')}
                  {unmatchedDistricts.length > 8
                    ? ` · +${unmatchedDistricts.length - 8} more`
                    : ''}
                </span>
              </p>
            )}
          </div>
        ) : filteredOutByService ? (
          <div className="mx-auto max-w-md space-y-2 text-sm text-muted-foreground">
            <p>
              <strong className="text-foreground">{totalUnclaimed}</strong>{' '}
              {totalUnclaimed === 1 ? 'job is' : 'jobs are'} available, but
              none match your accepted service types.
            </p>
            <p className="text-xs">
              You accept:{' '}
              <span className="font-mono text-foreground">
                {serviceTypes.join(' · ')}
              </span>
            </p>
          </div>
        ) : (
          <p className="mx-auto max-w-md text-sm text-muted-foreground">
            Nothing matches the current filters. Try clearing them.
          </p>
        )}
      </CardContent>
    </Card>
  )
}

function JobCard({ job }: { job: AvailableJobRow }) {
  const district = job.property.postcode?.split(' ')[0] ?? '—'
  const propertyLabel = describeProperty(job)
  // The available-jobs feed hides addressLine1 until a clerk accepts —
  // the reference falls back to "<postcode-district>-<id-suffix>" here,
  // which still beats a bare UUID for spotting "BS1" jobs at a glance.
  const refSlug = formatJobReference({
    jobId: job.id,
    postcode: job.property.postcode,
  })
  const payout = Number(job.clerkPayout ?? 0)
  const area = `${district}, ${job.property.city ?? '—'}`
  // Every service on the booking, not just the primary — a bundled
  // check-in is work the Pro has to schedule with the tenant, and it used
  // to be invisible until they were already on site.
  const serviceLabels = jobServiceLabels(job)
  const needsTenantAppointment = tenantAppointmentServices(job).length > 0
  return (
    <Card className="group transition-colors hover:border-primary/50">
      <CardContent className="space-y-3 p-5">
        <PropertyThumbnail
          src={job.property.imageUrl}
          alt={`Property in ${area}`}
        />
        <div className="flex flex-wrap items-center gap-2">
          {serviceLabels.map((label) => (
            <Badge key={label} variant="outline" className="text-xs">
              {label}
            </Badge>
          ))}
          {job.shortNoticeSurcharge && (
            <Badge
              variant="outline"
              className="gap-0.5 border-amber-500/30 bg-amber-500/10 text-[10px] text-amber-700"
            >
              <Zap className="h-3 w-3" /> Urgent
            </Badge>
          )}
          {job.isRepeat && (
            <Badge
              variant="outline"
              className="gap-0.5 border-primary/30 bg-primary/10 text-[10px] text-primary"
            >
              <RefreshCw className="h-3 w-3" /> Repeat
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
          <MapPin className="h-4 w-4 text-muted-foreground" />
          {area}
        </div>

        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Home className="h-3.5 w-3.5" />
          {propertyLabel}
        </div>

        {needsTenantAppointment && (
          <p className="flex items-start gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-[11px] text-amber-700">
            <Users className="mt-px h-3 w-3 shrink-0" />
            <span>
              Includes a tenant hand-over — you&apos;ll need to agree the
              appointment with the tenant directly.
            </span>
          </p>
        )}

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <CalendarIcon className="h-3.5 w-3.5" />
            {formatScheduled(job.scheduledDate)}
            {job.preferredTimeSlot ? ` · ${job.preferredTimeSlot}` : ''}
          </div>
          <div className="flex items-center gap-1 text-lg font-bold text-foreground">
            <PoundSterling className="h-4 w-4" />
            {payout.toFixed(2)}
          </div>
        </div>

        <div className="flex items-end justify-between gap-2 pt-2">
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />
            Posted {formatRelative(job.createdAt)} ago
          </span>
          <JobDetailsModal
            data={{
              jobId: job.id,
              refSlug,
              area,
              serviceTypeLabel: jobServiceSummary(job),
              needsTenantAppointment,
              imageUrl: job.property.imageUrl,
              propertyLabel,
              scheduledDateLabel: formatScheduled(job.scheduledDate),
              timePreference: job.preferredTimeSlot ?? 'Flexible',
              timeSlot: job.preferredTimeSlot,
              furnishedLabel:
                FURNISHED_STATUS_LABELS[
                  job.property.furnishedStatus as FurnishedStatus
                ] ?? job.property.furnishedStatus,
              serviceTierLabel:
                TIER_LABELS[job.serviceTier as ServiceTier] ??
                job.serviceTier,
              isRepeat: job.isRepeat,
              isUrgent: !!job.shortNoticeSurcharge,
              specialInstructions: job.specialInstructions,
              payout,
              payoutLines: job.payoutLines,
            }}
          />
        </div>
      </CardContent>
    </Card>
  )
}

function describeProperty(job: AvailableJobRow): string {
  // Use the actual bedroom count as the single source of truth. The
  // `propertyType` size-band can disagree with `bedrooms` (e.g. a 2-bedroom
  // flat stored against the `1_bed` band), which previously rendered the
  // contradictory "2-bed 1 bedroom". One number, no contradiction.
  const beds = job.property.bedrooms
  // 0039 — lead with the kind of building where the client stated it,
  // so the card reads "Flat · 2 bedrooms" rather than just a bed count.
  const kind = dwellingLabel(job.property.dwellingType)
  const size =
    beds === 0 || job.property.propertyType === 'studio'
      ? 'Studio'
      : `${beds} bedroom${beds === 1 ? '' : 's'}`
  if (!kind) return size
  // "Studio · Studio" helps nobody.
  return kind === size ? kind : `${kind} · ${size}`
}

/**
 * Client-supplied photo of the property, or a neutral placeholder. Sized
 * as a wide banner so a phone snap of a front door still reads at a
 * glance in the card grid. `unoptimized` because the src is a short-lived
 * signed storage URL — running it through the image optimiser would cache
 * a URL that expires in an hour.
 */
function PropertyThumbnail({
  src,
  alt,
}: {
  src: string | null
  alt: string
}) {
  if (!src) {
    return (
      <div className="flex h-28 w-full items-center justify-center rounded-lg border border-dashed border-border bg-muted/40">
        <Home className="h-6 w-6 text-muted-foreground/40" />
      </div>
    )
  }
  return (
    <div className="relative h-28 w-full overflow-hidden rounded-lg border border-border bg-muted">
      {/* eslint-disable-next-line @next/next/no-img-element -- signed storage URL, expires hourly */}
      <img src={src} alt={alt} className="h-full w-full object-cover" />
    </div>
  )
}

function formatScheduled(ymd: string): string {
  const d = new Date(ymd)
  return d.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function formatRelative(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const minutes = Math.floor(diffMs / (1000 * 60))
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d`
  const months = Math.floor(days / 30)
  return `${months}mo`
}
