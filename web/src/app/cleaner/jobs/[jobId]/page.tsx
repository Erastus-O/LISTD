import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, Calendar, MapPin, PoundSterling } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { requireRole } from '@/lib/dal'
import { loadCleanerJobDetail } from '@/lib/dashboard/cleaner-jobs'
import { getEffectivePricing } from '@/lib/pricing-settings'
import { getCleaningChecklistForType } from '@/lib/cleaning/checklists'
import { CleanerJobActions } from './cleaner-job-actions'
import {
  SiteActionsCard,
  type SiteEventSummary,
} from '@/components/jobs/site-actions-card'
import { jobSiteEvents, withServiceRole } from '@/db'
import { asc, eq } from 'drizzle-orm'
import { formatUkTime } from '@/lib/scheduling/exact-time'
import { StatusPill } from '@/components/listd/job-status'
import { JobThread } from '@/components/listd/job-thread'
import { RequotePanel } from '@/components/listd/requote-panel'
import { cleaningAreas } from '@/lib/listd/area-frames'
import { loadThread } from '@/lib/listd/job-messages'

export const metadata = { title: 'Cleaner · Job detail' }
export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ jobId: string }> }

export default async function CleanerJobDetailPage({ params }: Props) {
  const { jobId } = await params
  const session = await requireRole('cleaner', 'admin')
  const job = await loadCleanerJobDetail(
    jobId,
    session.userId,
    session.roles.includes('admin')
  )
  if (!job) notFound()

  const pricing = await getEffectivePricing()
  const checklist = getCleaningChecklistForType(
    job.inspectionType,
    pricing.cleaning
  )
  const pay = Number(job.cleanerFinalPayout ?? job.cleanerPayout ?? 0)
  const thread = await loadThread(jobId, 'pro', session.roles.includes('admin') ? 'listd' : 'pro')

  // On-site events (0038) — arrival / running-late / no-access drive the
  // On-site card while the job is live. Defensive fallback for a DB that
  // hasn't run the migration yet.
  const isOnSitePhase = !job.awaitingListd && ['accepted', 'assigned', 'in_progress'].includes(
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
          .where(eq(jobSiteEvents.jobId, jobId))
          .orderBy(asc(jobSiteEvents.createdAt))
          .then((rows) => rows as SiteEventSummary[])
      ).catch(() => [] as SiteEventSummary[])
    : []

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-6 py-10">
      <Link
        href="/cleaner/jobs"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to my jobs
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-mono text-2xl text-foreground">
            {jobId.slice(0, 8)}
          </h1>
          <Badge variant="outline">{job.label}</Badge>
          <StatusPill status={job.status} />
        </div>
        <span className="flex items-center gap-1 text-2xl font-bold text-primary">
          <PoundSterling className="h-5 w-5" />
          {pay.toFixed(2)}
        </span>
      </div>

      <Card>
        <CardContent className="space-y-4 p-6">
          <h2 className="text-base font-semibold">Job details</h2>
          {job.property && (
            <div className="flex items-start gap-3">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <div>
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
              </div>
            </div>
          )}
          <div className="flex items-center gap-3">
            <Calendar className="h-4 w-4 text-primary" />
            <span className="text-sm">
              {new Date(job.scheduledDate).toLocaleDateString('en-GB', {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}
              {job.scheduledAt
                ? ` · arrival ${formatUkTime(job.scheduledAt)}`
                : job.preferredTimeSlot
                  ? ` · ${job.preferredTimeSlot}`
                  : ''}
            </span>
          </div>
          {checklist && (
            <p className="text-sm text-muted-foreground">{checklist.scope}</p>
          )}
          {job.specialInstructions && (
            <div className="rounded-lg border border-border bg-muted/30 p-3">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Notes from client
              </p>
              <p className="mt-1 whitespace-pre-line text-sm">
                {job.specialInstructions}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {job.awaitingListd && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="space-y-1 p-4">
            <p className="text-sm font-medium text-foreground">Waiting for LISTD approval</p>
            <p className="text-xs text-muted-foreground">
              LISTD checks every booking during the beta. Once it&apos;s approved you&apos;ll get the full address, access codes and the job brief here and by email.
            </p>
          </CardContent>
        </Card>
      )}

      {isOnSitePhase && (
        <SiteActionsCard
          jobId={jobId}
          apiBase="/api/cleaner"
          initialEvents={siteEvents}
          status={job.status}
        />
      )}

      {isOnSitePhase && <RequotePanel jobId={jobId} />}

      {checklist && !job.awaitingListd && (
        <CleanerJobActions
          jobId={jobId}
          status={job.status}
          tasks={checklist.tasks}
          completion={job.completion}
          areas={cleaningAreas(job.areaCounts)}
        />
      )}

      <JobThread
        jobId={jobId}
        channel="pro"
        me={session.roles.includes('admin') ? 'listd' : 'pro'}
        title="Messages with LISTD"
        hint="Questions, access problems or anything the client needs to know. LISTD passes it on."
        messages={thread}
        disabled={['completed', 'paid', 'cancelled'].includes(job.status)}
      />
    </div>
  )
}
