import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, History, Scale } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { AuditTrailCard } from '@/components/admin/audit-trail-card'
import { requireRole } from '@/lib/dal'
import { loadAuditTrail } from '@/lib/audit-events'
import {
  DISPUTE_BADGE_TONE,
  loadAdminDisputeDetail,
} from '@/lib/dashboard/admin-disputes'
import { STATUS_BADGE_TONE } from '@/lib/dashboard/admin-jobs'
import {
  INSPECTION_TYPE_LABELS,
  type InspectionType,
} from '@/lib/pricing-matrix'
import { DisputeResolutionForm } from './dispute-resolution-form'

type Props = { params: Promise<{ disputeId: string }> }

export const metadata = { title: 'Admin · Dispute detail' }

const STATUS_LABELS: Record<string, string> = {
  open: 'Open',
  under_review: 'Under review',
  resolved: 'Resolved',
  escalated: 'Escalated',
}

export default async function AdminDisputeDetailPage({ params }: Props) {
  await requireRole('admin')
  const { disputeId } = await params
  const data = await loadAdminDisputeDetail(disputeId)
  if (!data) notFound()
  const { dispute, job, property, resolverName } = data

  // Two trails surface here:
  //   1. The dispute's own trail — every transition the resolve handler
  //      writes (S6d-2 + 0006 dispute audit category). `targetType='dispute'`.
  //   2. The linked-job trail (already shown as a small inline snippet)
  //      gives reviewers cross-cutting context — strikes issued, pricing
  //      overrides, status flips that happened on the same job during
  //      the dispute window.
  const [disputeAuditEntries, jobAuditEntries] = await Promise.all([
    loadAuditTrail('dispute', disputeId),
    job ? loadAuditTrail('job', job.id) : Promise.resolve([]),
  ])

  // The party-against is usually the clerk; offer strike issuance only
  // if they hold the clerk role.
  const strikeTarget =
    dispute.raisedAgainst.role === 'clerk'
      ? {
          userId: dispute.raisedAgainst.userId,
          fullName: dispute.raisedAgainst.fullName,
        }
      : null

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-6 py-10">
      <Link
        href="/admin/disputes"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to disputes
      </Link>

      <div className="flex flex-wrap items-center gap-3">
        <Scale className="h-6 w-6 text-muted-foreground" />
        <h1 className="font-mono text-2xl text-foreground">
          {dispute.id.slice(0, 8)}
        </h1>
        <Badge variant={DISPUTE_BADGE_TONE[dispute.status] ?? 'outline'}>
          {STATUS_LABELS[dispute.status] ?? dispute.status}
        </Badge>
        <span className="text-sm text-muted-foreground">
          Opened {formatDateTime(dispute.createdAt)}
        </span>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        {/* LEFT — read view */}
        <div className="space-y-6">
          <Card>
            <CardContent className="space-y-3 p-6 text-sm">
              <h2 className="text-sm font-semibold">Dispute details</h2>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs text-muted-foreground">Raised by</p>
                  <p className="font-medium">
                    {dispute.raisedBy.fullName ?? '—'}
                    {dispute.raisedBy.role && (
                      <Badge
                        variant="outline"
                        className="ml-1.5 text-[10px] capitalize"
                      >
                        {dispute.raisedBy.role}
                      </Badge>
                    )}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Against</p>
                  <p className="font-medium">
                    {dispute.raisedAgainst.fullName ?? '—'}
                    {dispute.raisedAgainst.role && (
                      <Badge
                        variant="outline"
                        className="ml-1.5 text-[10px] capitalize"
                      >
                        {dispute.raisedAgainst.role}
                      </Badge>
                    )}
                  </p>
                </div>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Reason</p>
                <p className="font-medium">{dispute.reason}</p>
              </div>
              {dispute.description && (
                <div>
                  <p className="text-xs text-muted-foreground">Description</p>
                  <p className="whitespace-pre-line">{dispute.description}</p>
                </div>
              )}
              {dispute.resolution && (
                <div className="rounded-md border border-border bg-muted/30 p-3">
                  <p className="text-xs text-muted-foreground">Resolution</p>
                  <p className="text-sm">{dispute.resolution}</p>
                  {resolverName && dispute.resolvedAt && (
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      By {resolverName} · {formatDateTime(dispute.resolvedAt)}
                    </p>
                  )}
                </div>
              )}
              {dispute.adminNotes && (
                <div className="rounded-md border border-amber-300/50 bg-amber-50/40 p-3 dark:bg-amber-900/20">
                  <p className="text-xs text-muted-foreground">
                    Admin notes (internal)
                  </p>
                  <p className="whitespace-pre-line text-sm">
                    {dispute.adminNotes}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {job && (
            <Card>
              <CardContent className="space-y-2 p-6 text-sm">
                <h2 className="text-sm font-semibold">Linked job</h2>
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/admin/jobs/${job.id}`}
                    className="font-mono text-xs text-primary hover:underline"
                  >
                    {job.id.slice(0, 8)}
                  </Link>
                  <Badge
                    variant={
                      STATUS_BADGE_TONE[
                        job.status as keyof typeof STATUS_BADGE_TONE
                      ] ?? 'outline'
                    }
                  >
                    {job.status.replace(/_/g, ' ')}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {INSPECTION_TYPE_LABELS[
                      job.inspectionType as InspectionType
                    ] ?? job.inspectionType}
                  </span>
                </div>
                {property && (
                  <p className="text-sm">
                    {property.addressLine1}
                    {property.city ? `, ${property.city}` : ''}
                    {property.postcode ? ` ${property.postcode}` : ''}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  Scheduled {job.scheduledDate}
                </p>
              </CardContent>
            </Card>
          )}

          <AuditTrailCard
            entries={disputeAuditEntries}
            entityNoun="dispute"
          />

          {jobAuditEntries.length > 0 && (
            <Card>
              <CardContent className="space-y-3 p-6">
                <h2 className="flex items-center gap-1.5 text-sm font-semibold">
                  <History className="h-4 w-4" />
                  Linked-job audit trail
                </h2>
                <ol className="space-y-2 text-xs">
                  {jobAuditEntries.slice(0, 12).map((e) => (
                    <li
                      key={e.id}
                      className="flex items-start justify-between gap-3 border-b border-border/60 pb-2 last:border-b-0 last:pb-0"
                    >
                      <span className="font-medium">
                        {e.action.replace(/[._]/g, ' ')}
                      </span>
                      <span className="text-muted-foreground">
                        {e.actorName ?? 'System'} ·{' '}
                        {formatDateTime(e.createdAt)}
                      </span>
                    </li>
                  ))}
                </ol>
                <p className="text-[11px] text-muted-foreground">
                  Full chronological feed on the{' '}
                  <Link
                    href={`/admin/jobs/${job?.id ?? ''}`}
                    className="text-primary hover:underline"
                  >
                    job detail
                  </Link>
                  .
                </p>
              </CardContent>
            </Card>
          )}
        </div>

        {/* RIGHT — resolution form */}
        <div>
          <DisputeResolutionForm
            disputeId={dispute.id}
            currentStatus={dispute.status}
            initialAdminNotes={dispute.adminNotes}
            initialResolution={dispute.resolution}
            strikeTarget={strikeTarget}
          />
        </div>
      </div>
    </div>
  )
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}
