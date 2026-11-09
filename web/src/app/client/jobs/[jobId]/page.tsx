import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  ArrowLeft,
  Calendar,
  CheckCircle2,
  Circle,
  Clock,
  Download,
  FileText,
  MapPin,
  Shield,
  User,
  XCircle,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { requireRole } from '@/lib/dal'
import {
  getStepperIndex,
  loadClientJobDetail,
  STEPPER_STEPS,
  type ClientJobDetail,
} from '@/lib/dashboard/client-job-detail'
import {
  FURNISHED_STATUS_LABELS,
  INSPECTION_TYPE_LABELS,
  type FurnishedStatus,
  type InspectionType,
} from '@/lib/pricing-matrix'
import { AddToCalendarButtons } from '@/components/calendar/add-to-calendar-buttons'
import {
  buildGoogleCalendarUrl,
  resolveJobSchedule,
} from '@/lib/calendar'
import { CancelJobButton } from './_components/cancel-job-button'
import { jobSiteEvents, withServiceRole } from '@/db'
import { desc, eq } from 'drizzle-orm'
import { formatUkTime } from '@/lib/scheduling/exact-time'
import { ClientJobActions } from '@/components/listd/client-job-actions'
import { ProgressRail, ServiceTag, StatusPill } from '@/components/listd/job-status'
import { loadClientJobActions } from '@/lib/listd/client-job'

export const metadata = { title: 'Client · Job detail' }
export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ jobId: string }> }

const TIME_SLOT_LABELS: Record<string, string> = {
  morning: 'Morning (8am – 12pm)',
  afternoon: 'Afternoon (12pm – 5pm)',
  flexible: 'Flexible',
}

const CANCELLABLE_STATUSES = new Set(['draft', 'pending', 'published'])

/**
 * Client job detail (Lovable port of `ClientJobDetail.tsx`).
 *
 * Two-column layout: details + timeline stepper on the left, report card +
 * read-only messages thread on the right. Cancel button only shows when
 * the job is still in a self-cancellable status — once a clerk has
 * accepted, cancellation moves through admin / dispute flow.
 *
 * Out of scope this round (no schema yet): job-access details (keysafe,
 * key collection address) and uploaded job_documents — Lovable referenced
 * tables that haven't been adopted in Listd-NEXT. Send-message UI is also
 * deferred; the messages card shows the existing thread read-only.
 */
export default async function ClientJobDetailPage({ params }: Props) {
  const session = await requireRole('client', 'admin')
  const { jobId } = await params
  const job = await loadClientJobDetail(jobId, session.userId)
  if (!job) notFound()
  const actions = await loadClientJobActions(job.id)

  const stepperIndex = getStepperIndex(job.status)
  const refSlug = job.id.slice(0, 8)

  // On-site signals (0038) — latest arrival / running-late flag from the
  // assigned pro, shown under the progress stepper while the job is live.
  // Defensive fallback for a DB that hasn't run the migration yet.
  const showOnSite = ['accepted', 'assigned', 'in_progress'].includes(
    job.status
  )
  const onSiteEvents = showOnSite
    ? await withServiceRole((tx) =>
        tx
          .select({
            kind: jobSiteEvents.kind,
            createdAt: jobSiteEvents.createdAt,
            etaMinutes: jobSiteEvents.etaMinutes,
          })
          .from(jobSiteEvents)
          .where(eq(jobSiteEvents.jobId, job.id))
          .orderBy(desc(jobSiteEvents.createdAt))
          .limit(10)
      ).catch(() => [])
    : []
  const arrivalEvent = onSiteEvents.find((e) => e.kind === 'arrival') ?? null
  const lateEvent = arrivalEvent
    ? null
    : (onSiteEvents.find((e) => e.kind === 'running_late') ?? null)
  const inspectionLabel =
    INSPECTION_TYPE_LABELS[job.inspectionType as InspectionType] ??
    job.inspectionType
  const price = job.finalPrice ?? job.quotedPrice
  const canCancel = CANCELLABLE_STATUSES.has(job.status)
  const isClosed =
    job.status === 'completed' ||
    job.status === 'cancelled' ||
    job.status === 'paid'

  // Calendar links — hidden when the job is closed (no point adding a
  // past inspection) or there's no schedule at all. Google URL is
  // server-built so we can ship it as a plain anchor; the ICS download
  // goes through the role-gated API route.
  const calendarSchedule = !isClosed
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
        url: `${process.env.NEXT_PUBLIC_SITE_URL ?? 'https://listd.co.uk'}/client/jobs/${job.id}`,
      })
    : null
  const calendarIcsUrl = `/api/calendar/job/${job.id}`

  return (
    <div className="w-full space-y-6 px-6 py-10">
      <Link
        href="/client/jobs"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to jobs
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-mono text-2xl text-foreground">{refSlug}</h1>
          <StatusPill status={job.status} />
          <ServiceTag type={job.inspectionType} label={inspectionLabel} />
        </div>
        {canCancel && <CancelJobButton jobId={job.id} />}
      </div>

      <ProgressRail status={job.status} />
      <ClientJobActions
        jobId={job.id}
        status={job.status}
        reviewDueAt={actions.reviewDueAt}
        quote={actions.quote}
        changeOrders={actions.changeOrders}
      />


      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        {/* LEFT — details + timeline */}
        <div className="space-y-6">
          {/* Job Details */}
          <Card>
            <CardContent className="space-y-4 p-6">
              <h2 className="text-base font-semibold">Job Details</h2>

              {job.property && (
                <div className="flex items-start gap-3">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">
                      {job.property.addressLine1}
                    </p>
                    {job.property.addressLine2 && (
                      <p className="text-xs text-muted-foreground">
                        {job.property.addressLine2}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {job.property.city}, {job.property.postcode}
                    </p>
                    <p className="mt-1 text-[11px] capitalize text-muted-foreground">
                      {job.property.propertyType?.replace(/_/g, ' ') ?? '—'} ·{' '}
                      {job.property.furnishedStatus
                        ? (FURNISHED_STATUS_LABELS[
                            job.property.furnishedStatus as FurnishedStatus
                          ] ?? job.property.furnishedStatus)
                        : '—'}
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
                  label="Date Required"
                >
                  {formatDate(job.scheduledDate)}
                </DetailRow>
                {job.scheduledAt ? (
                  <DetailRow
                    icon={<Clock className="h-4 w-4 text-primary" />}
                    label="Confirmed Arrival"
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
                {price && (
                  <DetailRow
                    icon={<FileText className="h-4 w-4 text-primary" />}
                    label="Client Price"
                  >
                    £{Number(price).toFixed(2)}
                  </DetailRow>
                )}
                <DetailRow
                  icon={<User className="h-4 w-4 text-primary" />}
                  label="Assigned Clerk"
                >
                  {job.clerk ? (
                    <span className="flex items-center gap-1.5">
                      {job.clerk.fullName ?? 'Clerk'}
                      {job.clerk.clerkLevel && (
                        <Badge
                          variant="outline"
                          className="text-[10px]"
                        >
                          Level {job.clerk.clerkLevel}
                        </Badge>
                      )}
                    </span>
                  ) : (
                    <span className="italic text-muted-foreground">
                      Awaiting clerk acceptance
                    </span>
                  )}
                </DetailRow>
                <DetailRow
                  icon={<FileText className="h-4 w-4 text-primary" />}
                  label="Service Tier"
                >
                  <span className="capitalize">{job.serviceTier}</span>
                </DetailRow>
              </div>

              {job.tenants.length > 0 && (
                <>
                  <div className="my-2 h-px bg-border" />
                  <div>
                    <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      Tenant{job.tenants.length === 1 ? '' : 's'}
                    </p>
                    <div className="space-y-1">
                      {job.tenants.map((t) => (
                        <p key={t.id} className="text-sm text-foreground">
                          {t.fullName ?? '—'}
                          {t.email ? ` · ${t.email}` : ''}
                          {t.phone ? ` · ${t.phone}` : ''}
                        </p>
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
                      Notes
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

          {/* Timeline stepper */}
          <Card>
            <CardContent className="space-y-4 p-6">
              <h2 className="text-base font-semibold">Job Progress</h2>
              {job.status === 'cancelled' ? (
                <div className="flex items-center gap-3 text-destructive">
                  <XCircle className="h-5 w-5" />
                  <p className="text-sm font-medium">
                    This job has been cancelled
                    {job.cancelledAt
                      ? ` on ${formatDate(job.cancelledAt)}`
                      : ''}
                  </p>
                </div>
              ) : (
                <>
                  <Stepper currentIndex={stepperIndex} />
                  {arrivalEvent && (
                    <p className="flex items-center gap-1.5 text-sm text-success">
                      <MapPin className="h-4 w-4 shrink-0" />
                      Your pro checked in at the property at{' '}
                      {formatTime(arrivalEvent.createdAt)}.
                    </p>
                  )}
                  {lateEvent && (
                    <p className="flex items-center gap-1.5 text-sm text-amber-700">
                      <Clock className="h-4 w-4 shrink-0" />
                      Your pro is running about {lateEvent.etaMinutes} minutes
                      late (flagged at {formatTime(lateEvent.createdAt)}).
                    </p>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </div>

        {/* RIGHT — report + messages */}
        <div className="space-y-6">
          <Card>
            <CardContent className="space-y-3 p-6">
              <h2 className="text-base font-semibold">Report</h2>
              {job.reportUrl ? (
                <>
                  <p className="text-sm text-muted-foreground">
                    Your inspection report is ready.
                  </p>
                  <a
                    href={`/api/reports/${job.id}/view`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90"
                  >
                    <Download className="h-4 w-4" />
                    Download Report
                  </a>
                </>
              ) : job.status === 'submitted' || job.status === 'reviewed' ? (
                <div className="flex items-start gap-3 text-sm">
                  <Shield className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                  <p className="text-muted-foreground">
                    Report is being reviewed: you&apos;ll be notified when ready.
                  </p>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {job.status === 'cancelled'
                    ? 'No report : job was cancelled.'
                    : 'Report will appear here once the inspection is complete.'}
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-3 p-6">
              <h2 className="text-base font-semibold">Messages</h2>
              <MessagesPanel
                messages={job.messages}
                userId={session.userId}
                isClosed={isClosed}
                hasClerk={Boolean(job.clerk)}
              />
            </CardContent>
          </Card>
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

function Stepper({ currentIndex }: { currentIndex: number }) {
  const completionPct =
    currentIndex >= 0
      ? Math.min(100, (currentIndex / (STEPPER_STEPS.length - 1)) * 100)
      : 0
  return (
    <div className="relative flex items-start justify-between">
      <div className="absolute left-4 right-4 top-4 h-0.5 bg-border" />
      <div
        className="absolute left-4 top-4 h-0.5 bg-primary transition-all"
        style={{
          width: `calc(${completionPct}% * (100% - 2rem) / 100%)`,
          maxWidth: 'calc(100% - 2rem)',
        }}
      />
      {STEPPER_STEPS.map((step, i) => {
        const isDone = i <= currentIndex
        const isCurrent = i === currentIndex
        return (
          <div
            key={step.key}
            className="relative z-10 flex flex-col items-center"
            style={{ width: `${100 / STEPPER_STEPS.length}%` }}
          >
            <div
              className={`flex h-8 w-8 items-center justify-center rounded-full border-2 transition-colors ${
                isDone
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-background text-muted-foreground'
              } ${isCurrent ? 'ring-2 ring-primary/30' : ''}`}
            >
              {isDone ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : (
                <Circle className="h-4 w-4" />
              )}
            </div>
            <p
              className={`mt-1.5 max-w-[80px] text-center text-[10px] leading-tight ${
                isDone
                  ? 'font-medium text-foreground'
                  : 'text-muted-foreground'
              }`}
            >
              {step.label}
            </p>
          </div>
        )
      })}
    </div>
  )
}

function MessagesPanel({
  messages,
  userId,
  isClosed,
  hasClerk,
}: {
  messages: ClientJobDetail['messages']
  userId: string
  isClosed: boolean
  hasClerk: boolean
}) {
  if (messages.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {!hasClerk
          ? 'Messaging will be available once a clerk is assigned.'
          : isClosed
            ? 'No messages on this job.'
            : 'No messages yet.'}
      </p>
    )
  }
  return (
    <>
      <div className="max-h-[320px] space-y-2 overflow-y-auto">
        {messages.map((msg) => {
          const isMine = msg.senderId === userId
          return (
            <div
              key={msg.id}
              className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[75%] rounded-lg px-3 py-2 text-sm ${
                  isMine
                    ? 'bg-primary/10 text-foreground'
                    : 'bg-muted text-foreground'
                }`}
              >
                <p>{msg.messageText}</p>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  {formatDateTime(msg.createdAt)}
                </p>
              </div>
            </div>
          )
        })}
      </div>
      {isClosed && (
        <p className="rounded-md bg-muted/40 p-2 text-[11px] text-muted-foreground">
          This job is closed. Open a dispute if you need to reach the clerk.
        </p>
      )}
      {!isClosed && (
        <p className="text-[11px] text-muted-foreground">
          Send-message UI ports with the messaging surface.
        </p>
      )}
    </>
  )
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

function formatTime(iso: string): string {
  // Server renders in UTC — pin to UK wall-clock so BST times read right.
  return new Date(iso).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/London',
  })
}
