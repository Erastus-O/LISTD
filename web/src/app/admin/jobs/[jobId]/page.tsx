import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  ArrowLeft,
  ClipboardCheck,
  FilePlus2,
  FileText,
  Home,
  KeyRound,
  MessageSquare,
  Receipt,
  ScrollText,
  User,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { requireRole } from '@/lib/dal'
import { loadJobAuditTrail } from '@/lib/audit-events'
import {
  formatJobRef,
  loadAdminJobDetail,
  loadJobMessages,
  loadVerifiedClerks,
  STATUS_BADGE_TONE,
} from '@/lib/dashboard/admin-jobs'
import { effectiveClerkPayout } from '@/lib/payout'
import {
  INSPECTION_TYPE_LABELS,
  TIER_LABELS,
  isCleaningType,
} from '@/lib/pricing-matrix'
import { getEffectivePricing } from '@/lib/pricing-settings'
import { AuditTrailCard } from '@/components/admin/audit-trail-card'
import { SiteEventsCard } from '@/components/admin/site-events-card'
import { formatUkTime } from '@/lib/scheduling/exact-time'
import { getCleaningChecklistForType } from '@/lib/cleaning/checklists'
import { AdminJobActions } from './admin-job-actions'
import { AdminNotesEditor } from '@/components/admin/admin-notes-editor'
import { AdminQuotePanel } from '@/components/listd/admin-quote-panel'
import { loadAdminQuotePanel } from '@/lib/listd/client-job'
import { CleaningSignoffActions } from './cleaning-signoff'
import { EditablePrice } from './editable-price'
import { HmoInvoiceTool } from './hmo-invoice-tool'

type Props = { params: Promise<{ jobId: string }> }

export const metadata = { title: 'Admin · Job detail' }

/**
 * Admin Job detail (S6c of the Lovable port). Server-rendered read view of
 * the job + its property / client / clerk / tenants. The Financial card uses
 * [`EditablePrice`](./editable-price.tsx) (a thin client island) which POSTs
 * to [/api/admin/jobs/[id]/pricing-override](../../../api/admin/jobs/[jobId]/pricing-override/route.ts).
 * That handler writes `pricing_override/pricing.override.<field>` audit rows
 * in the same tx as the UPDATE, closing the F5 audit gap.
 *
 * Lovable parity (added 2026-05): Access Details + Admin Notes + Message
 * Thread cards, Delete Job + Raise Dispute actions, LST-YYYY-NNNN job ref,
 * always-on Margin row. The schema additions ride in migration 0008.
 */
export default async function AdminJobDetailPage({ params }: Props) {
  await requireRole('admin')
  const { jobId } = await params
  const [job, clerks, auditEntries, messageRows] = await Promise.all([
    loadAdminJobDetail(jobId),
    loadVerifiedClerks(),
    loadJobAuditTrail(jobId),
    loadJobMessages(jobId),
  ])
  if (!job) notFound()

  const ref = formatJobRef(job.createdAt, job.jobRefNumber)
  const clientName =
    job.client?.companyName ?? job.client?.fullName ?? '(no client)'
  const inspectionLabel =
    INSPECTION_TYPE_LABELS[job.inspectionType] ?? job.inspectionType
  const tierLabel = TIER_LABELS[job.serviceTier] ?? job.serviceTier
  const hasAccessDetails =
    !!job.accessMethod || !!job.accessCollection || !!job.accessParkingNotes

  // Effective clerk pay falls back to the quoted `clerkPayout` until an admin
  // finalises `clerkFinalPayout` (which carries a DB default '0'). Margin is a
  // stored column but is null/0 on jobs that never had an explicit override —
  // compute it from (final ?? quoted) − clerk pay − bonus for display.
  const effectivePay = effectiveClerkPayout(job.clerkFinalPayout, job.clerkPayout)
  const clientPrice = Number(job.finalPrice ?? job.quotedPrice ?? 0)
  const clerkBonus = Number(job.clerkBonus ?? 0)
  const storedMargin = Number(job.margin ?? 0)
  const displayMargin =
    storedMargin > 0 ? storedMargin : clientPrice - effectivePay - clerkBonus

  // Cleaning sign-off: a clean the cleaner has finished sits in `submitted`
  // until an admin approves it (which releases the cleaner's payout).
  const quotePanel = await loadAdminQuotePanel(job.id)
  const isClean = isCleaningType(job.inspectionType)
  const isRepair = String(job.inspectionType) === 'repairs'
  const awaitingCleanSignoff = (isClean || isRepair) && job.status === 'submitted'
  const checklist = job.cleaningChecklist
  const cleanTaskTotal = isClean
    ? getCleaningChecklistForType(
        job.inspectionType,
        (await getEffectivePricing()).cleaning
      )?.tasks.length ?? 0
    : 0
  const cleanTasksDone = checklist?.checkedTasks?.length ?? 0
  const cleanPhotoCount = checklist?.photos?.length ?? 0

  return (
    <div className="w-full space-y-6 px-6 py-10">
      <Link
        href="/admin/jobs"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to jobs
      </Link>

      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-semibold text-2xl text-foreground">{ref}</h1>
        <Badge variant={STATUS_BADGE_TONE[job.status]}>
          {job.status.replace(/_/g, ' ')}
        </Badge>
        <span className="text-sm text-muted-foreground">
          {inspectionLabel} · {tierLabel}
        </span>
      </div>

      <AdminQuotePanel

        jobId={job.id}

        jobStatus={job.status}

        isRepair={isRepair}

        pricing={quotePanel.pricing}

        current={quotePanel.current}

        suggested={quotePanel.suggested}

        defaultProFeeP={quotePanel.defaultProFeeP}

        changeOrders={quotePanel.changeOrders}

      />

      {awaitingCleanSignoff && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="space-y-3 p-6">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold">
              <ClipboardCheck className="h-4 w-4" /> Cleaning sign-off
            </h2>
            <p className="text-sm text-muted-foreground">
              The cleaner has completed this clean. Approving releases their
              payout and issues the client&rsquo;s receipt.
            </p>
            <div className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">
                {cleanTasksDone}/{cleanTaskTotal}
              </span>{' '}
              checklist tasks ticked
              {cleanPhotoCount > 0
                ? ` · ${cleanPhotoCount} photo${cleanPhotoCount === 1 ? '' : 's'}`
                : ''}
            </div>
            {checklist?.notes ? (
              <p className="rounded-md bg-background p-2 text-xs text-muted-foreground">
                “{checklist.notes}”
              </p>
            ) : null}
            <CleaningSignoffActions jobId={job.id} />
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* LEFT */}
        <div className="space-y-6">
          <Card>
            <CardContent className="space-y-2 p-6">
              <h2 className="flex items-center gap-1.5 text-sm font-semibold">
                <Home className="h-4 w-4" /> Property
              </h2>
              <p className="text-sm font-medium">
                {job.property?.addressLine1 ?? '—'}
              </p>
              <p className="text-sm">
                {[job.property?.city, job.property?.postcode]
                  .filter(Boolean)
                  .join(', ') || '—'}
              </p>
              {job.property?.propertyType && (
                <p className="text-xs capitalize text-muted-foreground">
                  {job.property.propertyType.replace(/_/g, ' ')} ·{' '}
                  {job.property.furnishedStatus?.replace(/_/g, ' ') ?? '—'}
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-2 p-6">
              <h2 className="flex items-center gap-1.5 text-sm font-semibold">
                <User className="h-4 w-4" /> Client
              </h2>
              <p className="text-sm font-medium">{clientName}</p>
              {job.client?.companyName && job.client?.fullName && (
                <p className="text-xs text-muted-foreground">
                  Contact: {job.client.fullName}
                </p>
              )}
              {job.clientPhone && (
                <p className="text-sm">{job.clientPhone}</p>
              )}
              {job.createdByName && (
                <p className="text-xs text-muted-foreground">
                  Created by:{' '}
                  <span className="text-foreground">{job.createdByName}</span>
                </p>
              )}
              {job.organisation?.name && (
                <p className="text-xs text-muted-foreground">
                  Org: {job.organisation.name}
                </p>
              )}
            </CardContent>
          </Card>

          {hasAccessDetails && (
            <Card>
              <CardContent className="space-y-2 p-6 text-sm">
                <h2 className="flex items-center gap-1.5 text-sm font-semibold">
                  <KeyRound className="h-4 w-4" /> Access details
                </h2>
                {job.accessMethod && (
                  <p>
                    <span className="text-muted-foreground">Method:</span>{' '}
                    <span className="font-medium">
                      {humaniseAccessMethod(job.accessMethod)}
                    </span>
                  </p>
                )}
                {job.accessCollection && (
                  <p>
                    <span className="text-muted-foreground">Collection:</span>{' '}
                    <span className="font-medium">{job.accessCollection}</span>
                  </p>
                )}
                {job.accessParkingNotes && (
                  <p>
                    <span className="text-muted-foreground">Parking:</span>{' '}
                    <span className="font-medium">{job.accessParkingNotes}</span>
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {job.tenants.length > 0 && (
            <Card>
              <CardContent className="space-y-3 p-6">
                <h2 className="text-sm font-semibold">Tenant details</h2>
                {job.tenants.map((t) => (
                  <div
                    key={t.id}
                    className="rounded border border-border p-2 text-sm"
                  >
                    <p className="font-medium">{t.fullName ?? '—'}</p>
                    {t.email && (
                      <p className="text-xs text-muted-foreground">{t.email}</p>
                    )}
                    {t.phone && (
                      <p className="text-xs text-muted-foreground">{t.phone}</p>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Financial — the only mutable card on this page right now. */}
          <Card>
            <CardContent className="space-y-2 p-6 text-sm">
              <h2 className="text-sm font-semibold">Financial</h2>
              <Row label="Client price">
                <EditablePrice
                  jobId={job.id}
                  field="quotedPrice"
                  value={job.quotedPrice}
                />
              </Row>
              <Row label="Final price">
                <EditablePrice
                  jobId={job.id}
                  field="finalPrice"
                  value={job.finalPrice}
                />
              </Row>
              <div className="my-2 h-px bg-border" />
              <Row label="Clerk pay">
                <EditablePrice
                  jobId={job.id}
                  field="clerkFinalPayout"
                  value={String(effectivePay)}
                />
              </Row>
              <Row label="Clerk bonus">
                <EditablePrice
                  jobId={job.id}
                  field="clerkBonus"
                  value={job.clerkBonus}
                />
              </Row>
              <Row label="Margin">
                <span className="text-xs text-muted-foreground">
                  £{displayMargin.toFixed(2)}
                </span>
              </Row>
              {job.shortNoticeSurchargeApplied && (
                <Badge variant="outline" className="text-[10px]">
                  Short-notice surcharge
                </Badge>
              )}
              {job.clerkPaymentDate && (
                <p className="text-xs text-muted-foreground">
                  Paid: {formatDate(job.clerkPaymentDate)}
                </p>
              )}
              <div className="my-2 h-px bg-border" />
              {job.invoiceId ? (
                <Link
                  href={`/admin/invoices/${job.invoiceId}`}
                  className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
                >
                  <Receipt className="h-3.5 w-3.5" />
                  View invoice
                </Link>
              ) : (
                <Link
                  href={`/admin/invoices/new?fromJob=${job.id}`}
                  className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
                >
                  <FilePlus2 className="h-3.5 w-3.5" />
                  Generate invoice from this job
                </Link>
              )}
              {/* HMO per-bedroom split — cleaning jobs only, before invoicing. */}
              {!job.invoiceId &&
                isCleaningType(job.inspectionType) && (
                  <HmoInvoiceTool
                    jobId={job.id}
                    total={Number(job.quotedPrice ?? 0)}
                    defaultBedrooms={job.property?.bedrooms ?? 0}
                  />
                )}
            </CardContent>
          </Card>
        </div>

        {/* RIGHT */}
        <div className="space-y-6">
          <Card>
            <CardContent className="space-y-2 p-6 text-sm">
              <h2 className="text-sm font-semibold">Job info</h2>
              <p>
                Scheduled: <span className="font-medium">{job.scheduledDate}</span>
                {job.preferredTimeSlot ? ` (${job.preferredTimeSlot})` : ''}
                {job.scheduledAt ? (
                  <span className="font-medium">
                    {' '}
                    · arrival {formatUkTime(job.scheduledAt)}
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    {' '}
                    · no exact time set
                  </span>
                )}
              </p>
              {job.specialInstructions && (
                <p className="text-xs text-muted-foreground">
                  Instructions: {job.specialInstructions}
                </p>
              )}
              {job.reportUrl && (
                <a
                  href={`/api/reports/${job.id}/view`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  <FileText className="h-3.5 w-3.5" />
                  View report PDF
                </a>
              )}
              {job.clerk && (
                <p className="text-xs text-muted-foreground">
                  Clerk:{' '}
                  <span className="text-foreground">
                    {job.clerk.fullName ?? '(no name)'}
                  </span>{' '}
                  · L{job.clerk.clerkLevel ?? 1}
                </p>
              )}
              <div className="space-y-0.5 pt-2 text-xs text-muted-foreground">
                <p>Created: {formatDateTime(job.createdAt)}</p>
                {job.acceptedAt && <p>Accepted: {formatDateTime(job.acceptedAt)}</p>}
                {job.deliveredAt && (
                  <p>Delivered: {formatDateTime(job.deliveredAt)}</p>
                )}
                {job.cancelledAt && (
                  <p className="text-destructive">
                    Cancelled: {formatDateTime(job.cancelledAt)}
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          <AdminJobActions
            jobId={job.id}
            jobRef={ref}
            currentStatus={job.status}
            currentClerkId={job.clerk?.userId ?? null}
            clientId={job.client?.userId ?? null}
            clerks={clerks}
            currentScheduledDate={job.scheduledDate}
            currentArrivalTime={
              job.scheduledAt ? formatUkTime(job.scheduledAt) : null
            }
          />

          <Card>
            <CardContent className="space-y-2 p-6">
              <h2 className="flex items-center gap-1.5 text-sm font-semibold">
                <ScrollText className="h-4 w-4" /> Admin notes
              </h2>
              <p className="text-[11px] text-muted-foreground">
                Admin-only: not visible to client, clerk or tenant.
              </p>
              <AdminNotesEditor
                endpoint={`/api/admin/jobs/${job.id}/admin-notes`}
                initial={job.adminNotes}
                placeholder="Admin-only notes (parking, access notes, payment exceptions…)"
              />
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-3 p-6">
              <h2 className="flex items-center gap-1.5 text-sm font-semibold">
                <MessageSquare className="h-4 w-4" /> Message thread (
                {messageRows.length})
              </h2>
              {messageRows.length === 0 ? (
                <p className="text-center text-xs text-muted-foreground">
                  No messages.
                </p>
              ) : (
                <ul className="space-y-2">
                  {messageRows.map((m) => (
                    <li
                      key={m.id}
                      className="rounded-md border border-border bg-muted/20 p-2.5 text-xs"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-foreground">
                          {m.senderName ?? 'Unknown'}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {formatDateTime(m.createdAt)}
                        </span>
                      </div>
                      <p className="mt-1 whitespace-pre-wrap text-muted-foreground">
                        {m.messageText}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <SiteEventsCard jobId={job.id} />

          <AuditTrailCard entries={auditEntries} entityNoun="job" />
        </div>
      </div>
    </div>
  )
}

function humaniseAccessMethod(raw: string): string {
  // Stored as snake_case (keys_at_office) or already human; surface both
  // gracefully without hardcoding the enum membership server-side.
  return raw
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="group">{children}</span>
    </div>
  )
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
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
