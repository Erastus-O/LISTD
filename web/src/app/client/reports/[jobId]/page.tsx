import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  ArrowLeft,
  Calendar,
  Download,
  ExternalLink,
  FileText,
  MapPin,
} from 'lucide-react'
import { desc, eq } from 'drizzle-orm'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { generatedReports, jobs, profiles, withServiceRole } from '@/db'
import { requireRole } from '@/lib/dal'
import { loadClientJobDetail } from '@/lib/dashboard/client-job-detail'
import { getEffectivePricing } from '@/lib/pricing-settings'
import {
  INSPECTION_TYPE_LABELS,
  resolveSignoffPolicy,
  type InspectionType,
} from '@/lib/pricing-matrix'
import { ReportSignoffAction } from './report-signoff-action'

export const metadata = { title: 'Client · Report' }
export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ jobId: string }> }

const READY_STATUSES = new Set([
  'submitted',
  'reviewed',
  'signed',
  'completed',
  'paid',
])

// Statuses that count as "client has signed off" — once a report
// passes signed/completed/paid the acceptance step is implicit.
// `ClientJobDetail` doesn't expose `clientReportAccepted` directly so
// we status-derive instead, matching how the rest of the codebase
// (lifecycle audits, invoice generation) treats sign-off.
const SIGNED_OFF_STATUSES = new Set(['signed', 'completed', 'paid'])

const STATUS_LABELS: Record<string, string> = {
  submitted: 'Submitted',
  reviewed: 'Reviewed',
  signed: 'Signed',
  completed: 'Completed',
  paid: 'Paid',
}

const STATUS_TONE: Record<
  string,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  submitted: 'outline',
  reviewed: 'secondary',
  signed: 'secondary',
  completed: 'secondary',
  paid: 'secondary',
}

/**
 * Client report viewer. Focused single-purpose surface — the PDF
 * inline, the key metadata, and a path back to the full job context
 * for the sign-off / messaging flow.
 *
 * Reuses `loadClientJobDetail` rather than a dedicated loader because:
 *   1. The auth check is identical (client must own the job).
 *   2. The data needed is a strict subset of what the job page already
 *      pulls.
 *   3. Anything we'd add here (clerk attribution, tenants, timeline)
 *      ends up duplicating the job loader, and readers wanting that
 *      context are sent to the full job page anyway.
 *
 * Sign-off + request-changes actions stay on the job detail page
 * because the messaging thread lives there. This page links across
 * with an anchor so the user lands at the right block.
 */
export default async function ClientReportDetailPage({ params }: Props) {
  const session = await requireRole('client', 'admin')
  const { jobId } = await params
  const job = await loadClientJobDetail(jobId, session.userId)
  if (!job) notFound()

  // Who signs this report (client vs tenant) + whether the client must
  // acknowledge receipt — from the service's sign-off policy.
  const pricing = await getEffectivePricing()
  const policy = resolveSignoffPolicy(job.inspectionType, pricing.customTypes)
  // Defensive: the sign-off columns ship with migration 0033; on a DB that
  // hasn't run it yet, fall back to "nothing recorded" rather than 500.
  const signoff = await withServiceRole((tx) =>
    tx
      .select({
        accepted: jobs.clientReportAccepted,
        acceptedAt: jobs.clientReportAcceptedAt,
        signatureName: jobs.clientSignatureName,
        acknowledgedAt: jobs.clientReportAcknowledgedAt,
      })
      .from(jobs)
      .where(eq(jobs.id, jobId))
      .limit(1)
      .then((r) => r[0])
  ).catch(() => undefined)

  // The signer's profile name — the sign-off form flags a typed signature
  // that doesn't match the name on the account.
  const accountName = await withServiceRole((tx) =>
    tx
      .select({ fullName: profiles.fullName })
      .from(profiles)
      .where(eq(profiles.userId, session.userId))
      .limit(1)
      .then((r) => r[0]?.fullName ?? null)
  ).catch(() => null)

  // Tenant signature status (for tenant-signs services) — so the client can
  // see whether the tenant has signed before confirming their own receipt.
  const tenantSign = await withServiceRole((tx) =>
    tx
      .select({
        signature: generatedReports.tenantSignature,
        signedAt: generatedReports.signedAt,
      })
      .from(generatedReports)
      .where(eq(generatedReports.jobId, jobId))
      .orderBy(desc(generatedReports.generatedAt))
      .limit(1)
      .then((r) => r[0])
  ).catch(() => undefined)

  const isReady = READY_STATUSES.has(job.status)
  const inspectionLabel =
    INSPECTION_TYPE_LABELS[job.inspectionType as InspectionType] ??
    job.inspectionType
  const refSlug = job.id.slice(0, 8)
  const address = job.property
    ? [job.property.addressLine1, job.property.city, job.property.postcode]
        .filter(Boolean)
        .join(', ')
    : 'Address withheld'

  return (
    <div className="w-full space-y-6 px-6 py-10">
      <Link
        href="/client/reports"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        All reports
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-mono text-2xl text-foreground">{refSlug}</h1>
            <Badge variant={STATUS_TONE[job.status] ?? 'outline'}>
              {STATUS_LABELS[job.status] ?? job.status}
            </Badge>
            <span className="text-sm text-muted-foreground">
              {inspectionLabel}
            </span>
          </div>
          <p className="mt-1.5 inline-flex items-center gap-1.5 text-sm text-foreground">
            <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
            {address}
          </p>
        </div>

        <Link
          href={`/client/jobs/${job.id}`}
          className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-2 text-sm font-medium shadow-sm hover:bg-accent"
        >
          Full job context
          <ExternalLink className="h-3.5 w-3.5" />
        </Link>
      </header>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        {/* LEFT — embedded PDF (when ready) */}
        <div>
          {!isReady ? (
            <Card>
              <CardContent className="space-y-3 py-12 text-center">
                <FileText className="mx-auto h-10 w-10 text-muted-foreground/40" />
                <p className="text-sm font-medium text-foreground">
                  Report not ready yet
                </p>
                <p className="mx-auto max-w-md text-xs text-muted-foreground">
                  Inspections move through admin quality review before
                  the PDF is published. You&rsquo;ll get an email the
                  moment it&rsquo;s available.
                </p>
              </CardContent>
            </Card>
          ) : !job.reportUrl ? (
            <Card>
              <CardContent className="space-y-3 py-12 text-center">
                <FileText className="mx-auto h-10 w-10 text-muted-foreground/40" />
                <p className="text-sm font-medium text-foreground">
                  PDF not on file yet
                </p>
                <p className="mx-auto max-w-md text-xs text-muted-foreground">
                  The inspection is past the review stage but the
                  rendered PDF isn&rsquo;t attached. Admin generates
                  these in batches; ping support if it&rsquo;s been
                  more than a day.
                </p>
              </CardContent>
            </Card>
          ) : (
            <Card className="overflow-hidden">
              <CardContent className="p-0">
                {/* Inline PDF embed. Modern browsers render PDFs in an
                    iframe natively; iOS Safari shows a tap-to-open
                    overlay because it doesn't render PDFs inline. The
                    Download button below is the universal escape
                    hatch. */}
                <iframe
                  src={`/api/reports/${jobId}/view`}
                  title={`Inspection report ${refSlug}`}
                  className="block h-[80vh] w-full border-0 bg-muted/30"
                />
                <div className="flex items-center justify-between gap-3 border-t border-border bg-muted/30 px-4 py-3">
                  <p className="text-xs text-muted-foreground">
                    Trouble viewing? Download the file and open in your
                    preferred PDF reader.
                  </p>
                  <a
                    href={`/api/reports/${jobId}/view`}
                    target="_blank"
                    rel="noopener noreferrer"
                    download={`listd-${inspectionLabel
                      .toLowerCase()
                      .replace(/\s+/g, '-')}-${refSlug}.pdf`}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-sm hover:bg-primary/90"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Download PDF
                  </a>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* RIGHT — at-a-glance metadata */}
        <aside className="space-y-3">
          <Card>
            <CardContent className="space-y-3 p-5">
              <h2 className="text-sm font-semibold">Inspection details</h2>
              <MetaRow
                icon={<Calendar className="h-3.5 w-3.5 text-muted-foreground" />}
                label="Scheduled"
              >
                {formatDate(job.scheduledDate)}
              </MetaRow>
              <MetaRow
                icon={<FileText className="h-3.5 w-3.5 text-muted-foreground" />}
                label="Type"
              >
                {inspectionLabel}
              </MetaRow>
              {job.clerk ? (
                <MetaRow
                  icon={
                    <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                  }
                  label="Clerk"
                >
                  {job.clerk.fullName ?? '—'}
                </MetaRow>
              ) : null}
              {SIGNED_OFF_STATUSES.has(job.status) && job.deliveredAt ? (
                <MetaRow
                  icon={
                    <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                  }
                  label="Delivered"
                >
                  {formatDate(job.deliveredAt)}
                </MetaRow>
              ) : null}
            </CardContent>
          </Card>

          {isReady && (
            <ReportSignoffAction
              jobId={job.id}
              signoffBy={policy.signoffBy}
              clientAckRequired={policy.clientAckRequired}
              accountName={accountName}
              signed={Boolean(signoff?.accepted)}
              signatureName={signoff?.signatureName ?? null}
              signedAt={signoff?.acceptedAt ?? null}
              acknowledgedAt={signoff?.acknowledgedAt ?? null}
              tenantSignature={tenantSign?.signature ?? null}
              tenantSignedAt={tenantSign?.signedAt ?? null}
            />
          )}
        </aside>
      </div>
    </div>
  )
}

function MetaRow({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-xs">
      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
        {icon}
        {label}
      </span>
      <span className="text-right font-medium text-foreground">
        {children}
      </span>
    </div>
  )
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return iso
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}
