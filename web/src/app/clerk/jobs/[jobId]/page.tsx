import { RepairCompletePanel } from '@/components/listd/pro-levels-panels'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import {
  ArrowLeft,
  Calendar,
  Clock,
  Download,
  FileText,
  History,
  MapPin,
  Send as SendIcon,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { requireRole } from '@/lib/dal'
import { JobThread } from '@/components/listd/job-thread'
import { RequotePanel } from '@/components/listd/requote-panel'
import { repairAreas } from '@/lib/listd/area-frames'
import { loadThread } from '@/lib/listd/job-messages'
import {
  loadClerkJobDetail,
  type ClerkJobDetail,
} from '@/lib/dashboard/clerk-job-detail'
import {
  FURNISHED_STATUS_LABELS,
  INSPECTION_TYPE_LABELS,
  type FurnishedStatus,
  type InspectionType,
} from '@/lib/pricing-matrix'
import { effectiveClerkPayout } from '@/lib/payout'
import {
  jobServiceSummary,
  tenantAppointmentLabels,
  tenantAppointmentServices,
} from '@/lib/jobs/services'
import { dwellingLabel } from '@/lib/property/dwelling'
import { formatSlot } from '@/lib/scheduling/slots'
import { AddToCalendarButtons } from '@/components/calendar/add-to-calendar-buttons'
import {
  buildGoogleCalendarUrl,
  resolveJobSchedule,
} from '@/lib/calendar'
import { MarkInProgressButton } from './_components/mark-in-progress-button'
import {
  SiteActionsCard,
  type SiteEventSummary,
} from '@/components/jobs/site-actions-card'
import { jobSiteEvents, withServiceRole } from '@/db'
import { asc, eq } from 'drizzle-orm'
import { formatUkTime } from '@/lib/scheduling/exact-time'
import { StatusPill } from '@/components/listd/job-status'

export const metadata = { title: 'Pro · Job detail' }
export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ jobId: string }> }

const TIME_SLOT_LABELS: Record<string, string> = {
  morning: 'Morning (8am – 12pm)',
  afternoon: 'Afternoon (12pm – 5pm)',
  flexible: 'Flexible',
}

/**
 * Clerk Job Detail (Lovable port of `ClerkJobDetail.tsx`).
 *
 * Two-column layout:
 *   Left  — status-aware action card · job details · previous jobs
 *   Right — client/tenants · messages thread (read-only stub)
 *
 * The data layer enforces ownership server-side: clerks who aren't on this
 * job get redirected to the available-jobs queue. Admins bypass for QA /
 * impersonation.
 *
 * Out of scope this round (no schema yet): job_access (keysafe details,
 * parking) and job_documents — Lovable referenced tables that haven't
 * been adopted in Listd-NEXT.
 */
export default async function ClerkJobDetailPage({ params }: Props) {
  const session = await requireRole('clerk', 'trades', 'admin')
  const { jobId } = await params
  const isAdmin = session.roles.includes('admin')
  const job = await loadClerkJobDetail(jobId, session.userId, isAdmin)
  if (!job) {
    if (!isAdmin) redirect('/clerk/jobs/available')
    notFound()
  }

  const refSlug = job.id.slice(0, 8)
  // The whole bundle, not just the primary service — a check-in booked
  // alongside an inventory is an appointment the clerk has to arrange, and
  // printing only `inspectionType` hid it completely.
  const inspectionLabel = jobServiceSummary(job)
  const tenantServices = tenantAppointmentServices(job)
  const payout = effectiveClerkPayout(job.clerkFinalPayout, job.clerkPayout)
  const isClosed = ['completed', 'paid', 'signed'].includes(job.status)

  // Calendar links — same shape as the client variant. Suppressed for
  // closed jobs (no point adding a past inspection to your cal).
  const calendarSchedule = !isClosed && !job.awaitingListd
    ? resolveJobSchedule({
        scheduledAt: job.scheduledAt,
        scheduledDate: job.scheduledDate,
      })
    : null
  const calendarGoogleUrl = calendarSchedule
    ? buildGoogleCalendarUrl({
        uid: `job-${job.id}`,
        title: `LISTD Inspection: ${inspectionLabel} at ${job.property?.addressLine1 ?? 'your property'}`,
        description: [
          `Inspection: ${inspectionLabel}`,
          `Reference: ${refSlug}`,
          !calendarSchedule.isExactTime
            ? '(Time is a placeholder : please confirm the exact slot.)'
            : null,
          job.preferredTimeSlot ? `Preferred time: ${job.preferredTimeSlot}` : null,
        ]
          .filter(Boolean)
          .join('\n'),
        location: job.property
          ? [
              job.property.addressLine1,
              job.property.city,
              job.property.postcode,
            ]
              .filter(Boolean)
              .join(', ')
          : 'TBC',
        startsAt: calendarSchedule.startsAt,
        endsAt: calendarSchedule.endsAt,
        url: `${process.env.NEXT_PUBLIC_SITE_URL ?? 'https://listd.co.uk'}/clerk/jobs/${job.id}`,
      })
    : null
  const calendarIcsUrl = `/api/calendar/job/${job.id}`
  const thread = await loadThread(job.id, 'pro', isAdmin ? 'listd' : 'pro')

  // On-site events (0038) — arrival / running-late / no-access drive the
  // On-site card while the job is live. Defensive fallback for a DB that
  // hasn't run the migration yet (0033 precedent).
  // Nothing on site until LISTD approves the booking.
  const waiting = job.awaitingListd
  const isOnSitePhase = !waiting && ['accepted', 'assigned', 'in_progress'].includes(
    job.status
  )
  const siteEvents: SiteEventSummary[] = isOnSitePhase
    ? await withServiceRole((tx) =>
        tx
          .select({
            id: jobSiteEvents.id,
            kind: jobSiteEvents.kind,
            createdAt: jobSiteEvents.createdAt,
            etaMinutes: jobSiteEvents.etaMinutes,
            reason: jobSiteEvents.reason,
          })
          .from(jobSiteEvents)
          .where(eq(jobSiteEvents.jobId, job.id))
          .orderBy(asc(jobSiteEvents.createdAt))
          .then((rows) => rows as SiteEventSummary[])
      ).catch(() => [] as SiteEventSummary[])
    : []

  return (
    <div className="w-full space-y-6 px-6 py-10">
      <Link
        href="/clerk/jobs"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to my jobs
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-mono text-2xl text-foreground">{refSlug}</h1>
          <StatusPill status={job.status} />
          <span className="text-sm text-muted-foreground">{inspectionLabel}</span>
        </div>
        <div className="text-2xl font-bold text-primary">
          £{payout.toFixed(2)}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        {/* LEFT */}
        <div className="space-y-6">
          {waiting && (
            <Card className="border-primary/30 bg-primary/5">
              <CardContent className="space-y-1 p-4">
                <p className="text-sm font-medium text-foreground">Waiting for LISTD approval</p>
                <p className="text-xs text-muted-foreground">
                  LISTD checks every booking during the beta. Once it&apos;s approved you&apos;ll get the full address, access codes, contacts and the job brief here and by email.
                </p>
              </CardContent>
            </Card>
          )}

          {/* On-site: check in / running late / no access */}
          {isOnSitePhase && (
            <SiteActionsCard
              jobId={job.id}
              apiBase="/api/clerk"
              initialEvents={siteEvents}
              status={job.status}
            />
          )}

          {/* Repairs have their own report, not the inspection editor. */}
          {String(job.inspectionType) === 'repairs' && !waiting &&
            job.status === 'in_progress' && (
              <RepairCompletePanel jobId={job.id} areas={repairAreas(job.scope)} />
            )}

          {/* Extra work found on site: requote with evidence, the client decides. */}
          {!waiting && ['accepted', 'assigned', 'in_progress'].includes(job.status) && <RequotePanel jobId={job.id} />}

          {/* Status-aware action */}
          {!waiting && ['accepted', 'assigned'].includes(job.status) && (
            <Card className="border-primary/30 bg-primary/5">
              <CardContent className="flex items-center justify-between gap-3 p-4">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {String(job.inspectionType) === 'repairs' ? 'Ready to start the repair?' : 'Ready to start the inspection?'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Check in with a photo of the front of the building, then mark as in progress.
                  </p>
                </div>
                <MarkInProgressButton jobId={job.id} />
              </CardContent>
            </Card>
          )}

          {job.status === 'in_progress' && String(job.inspectionType) !== 'repairs' && (
            <Card className="border-primary/30 bg-primary/5">
              <CardContent className="flex items-center justify-between gap-3 p-4">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    Inspection in progress
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Walk through the property to record condition + photos.
                  </p>
                </div>
                <Button asChild className="gap-1.5">
                  <Link href={`/clerk/jobs/${job.id}/inspect`}>
                    <SendIcon className="h-4 w-4" />
                    Start Inspection
                  </Link>
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Job Details */}
          <Card>
            <CardContent className="space-y-4 p-6">
              <h2 className="text-base font-semibold">Job Details</h2>

              {job.property && (
                <div className="flex items-start gap-3">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">
                      {waiting ? 'Full address shared once LISTD approves' : job.property.addressLine1}
                    </p>
                    {job.property.addressLine2 && (
                      <p className="text-xs text-muted-foreground">
                        {job.property.addressLine2}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {job.property.city}, {job.property.postcode}
                    </p>
                  </div>
                </div>
              )}

              <div className="my-2 h-px bg-border" />

              <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
                <DetailRow
                  icon={<FileText className="h-4 w-4 text-primary" />}
                  label="Service Type"
                >
                  {inspectionLabel}
                </DetailRow>
                <DetailRow
                  icon={<Calendar className="h-4 w-4 text-primary" />}
                  label="Date"
                >
                  {formatDate(job.scheduledDate)}
                </DetailRow>
                {job.scheduledAt ? (
                  <DetailRow
                    icon={<Clock className="h-4 w-4 text-primary" />}
                    label="Your Arrival Time"
                  >
                    {formatUkTime(job.scheduledAt)}
                  </DetailRow>
                ) : (
                  job.preferredTimeSlot && (
                    <DetailRow
                      icon={<Clock className="h-4 w-4 text-primary" />}
                      label="Time Preference"
                    >
                      {TIME_SLOT_LABELS[job.preferredTimeSlot] ??
                        job.preferredTimeSlot}
                    </DetailRow>
                  )
                )}
                {job.property && (
                  <DetailRow
                    icon={<FileText className="h-4 w-4 text-primary" />}
                    label="Property"
                  >
                    {describeProperty(job.property)}
                  </DetailRow>
                )}
                <DetailRow
                  icon={<FileText className="h-4 w-4 text-primary" />}
                  label="Service Tier"
                >
                  <span className="capitalize">{job.serviceTier}</span>
                </DetailRow>
                <DetailRow
                  icon={<FileText className="h-4 w-4 text-primary" />}
                  label="Clerk Pay"
                >
                  <span className="font-semibold text-primary">
                    £{payout.toFixed(2)}
                  </span>
                </DetailRow>
              </div>

              {job.payoutLines.length > 0 && (
                <>
                  <div className="my-2 h-px bg-border" />
                  <div>
                    <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      Pay breakdown
                    </p>
                    <dl className="space-y-1 text-sm">
                      {job.payoutLines.map((line, i) => (
                        <div
                          key={i}
                          className="flex items-center justify-between gap-2"
                        >
                          <dt className="text-muted-foreground">{line.label}</dt>
                          <dd className="font-medium text-foreground">
                            £{line.amount.toFixed(2)}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                </>
              )}

              {job.tenantSlots.length > 0 && (
                <>
                  <div className="my-2 h-px bg-border" />
                  <div>
                    <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      Tenant availability
                    </p>
                    <p className="mb-2 text-xs text-muted-foreground">
                      The tenant said they&rsquo;re available for these 30-minute
                      slots: pick one that works.
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {job.tenantSlots.map((s) => (
                        <span
                          key={s}
                          className="rounded-md border border-primary/30 bg-primary/5 px-2 py-1 text-xs font-medium text-foreground"
                        >
                          {formatSlot(s)}
                        </span>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {job.specialInstructions && (
                <>
                  <div className="my-2 h-px bg-border" />
                  <div>
                    <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      Special Instructions
                    </p>
                    <p className="whitespace-pre-line text-sm">
                      {job.specialInstructions}
                    </p>
                  </div>
                </>
              )}

              {calendarGoogleUrl && (
                <>
                  <div className="my-2 h-px bg-border" />
                  <div className="space-y-2">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      Add to calendar
                    </p>
                    <AddToCalendarButtons
                      googleUrl={calendarGoogleUrl}
                      icsUrl={calendarIcsUrl}
                      filenameLabel={`listd-${inspectionLabel.toLowerCase().replace(/\s+/g, '-')}-${refSlug}`}
                    />
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Previous jobs at this property */}
          {job.previousJobsAtProperty.length > 0 && (
            <Card>
              <CardContent className="space-y-3 p-6">
                <h2 className="flex items-center gap-1.5 text-base font-semibold">
                  <History className="h-4 w-4" />
                  Previous jobs at this property
                </h2>
                <ul className="space-y-2">
                  {job.previousJobsAtProperty.map((p) => (
                    <li
                      key={p.id}
                      className="flex items-center justify-between gap-3 border-b border-border/60 pb-2 last:border-b-0 last:pb-0"
                    >
                      <span className="text-xs text-foreground">
                        {INSPECTION_TYPE_LABELS[
                          p.inspectionType as InspectionType
                        ] ?? p.inspectionType}{' '}
                        · {formatDate(p.scheduledDate)}
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        {p.clerkFullName ?? '—'}
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {/* Report download (if delivered) */}
          {job.reportUrl && (
            <Card>
              <CardContent className="space-y-2 p-6">
                <h2 className="text-base font-semibold">Report</h2>
                <a
                  href={`/api/reports/${job.id}/view`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-sm transition-colors hover:bg-muted"
                >
                  <Download className="h-4 w-4" />
                  Download submitted report
                </a>
              </CardContent>
            </Card>
          )}
        </div>

        {/* RIGHT */}
        <div className="space-y-6">
          {/* Tenants */}
          {job.tenants.length > 0 && (
            <Card>
              <CardContent className="space-y-3 p-6">
                <h2 className="text-base font-semibold">
                  Tenant{job.tenants.length === 1 ? '' : 's'}
                </h2>
                {tenantServices.length > 0 && (
                  <p className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs leading-relaxed text-amber-700">
                    This booking includes a{' '}
                    {tenantAppointmentLabels(job).join(' and ')} — arrange the
                    appointment with the tenant directly; they need to be
                    present for it.
                  </p>
                )}
                <ul className="space-y-2 text-sm">
                  {job.tenants.map((t) => (
                    <li key={t.id} className="space-y-0.5">
                      <p className="font-medium">{t.fullName ?? '—'}</p>
                      {t.email && (
                        <p className="text-xs text-muted-foreground">
                          {t.email}
                        </p>
                      )}
                      {t.phone && (
                        <p className="text-xs text-muted-foreground">
                          {t.phone}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {/* Messages: the Pro talks to LISTD only; LISTD relays to the client. */}
          <JobThread
            jobId={job.id}
            channel="pro"
            me={isAdmin ? 'listd' : 'pro'}
            title="Messages with LISTD"
            hint="Questions, access problems or anything the client needs to know. LISTD passes it on."
            messages={thread}
            disabled={isClosed}
          />
        </div>
      </div>
    </div>
  )
}

function DetailRow({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-start gap-2.5">
      <div className="mt-0.5 shrink-0">{icon}</div>
      <div className="min-w-0">
        <p className="text-[11px] text-muted-foreground">{label}</p>
        <div className="text-sm font-medium text-foreground">{children}</div>
      </div>
    </div>
  )
}

function describeProperty(prop: NonNullable<ClerkJobDetail['property']>): string {
  // Single source of truth = the actual bedroom count. The `propertyType`
  // size-band can disagree with `bedrooms`, which previously rendered the
  // contradictory "2-bed 1 bed".
  const beds = prop.bedrooms ?? 0
  const furnished = prop.furnishedStatus
    ? FURNISHED_STATUS_LABELS[prop.furnishedStatus as FurnishedStatus] ??
      prop.furnishedStatus
    : null
  const size =
    beds === 0 || prop.propertyType === 'studio'
      ? 'Studio'
      : `${beds} bedroom${beds === 1 ? '' : 's'}`
  // 0039 — lead with the kind of building where the client stated it.
  const kind = dwellingLabel(prop.dwellingType)
  const base = !kind || kind === size ? size : `${kind} · ${size}`
  return furnished && furnished !== 'Unfurnished'
    ? `${base} (${furnished})`
    : base
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}
