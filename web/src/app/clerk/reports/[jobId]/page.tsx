import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  ArrowLeft,
  Calendar,
  Download,
  ExternalLink,
  FileText,
  MapPin,
  PoundSterling,
  User,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { requireRole } from '@/lib/dal'
import { loadClerkJobDetail } from '@/lib/dashboard/clerk-job-detail'
import { effectiveClerkPayout } from '@/lib/payout'
import {
  INSPECTION_TYPE_LABELS,
  type InspectionType,
} from '@/lib/pricing-matrix'

export const metadata = { title: 'Pro · Report' }
export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ jobId: string }> }

const READY_STATUSES = new Set([
  'submitted',
  'reviewed',
  'signed',
  'completed',
  'paid',
])

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
 * Clerk report viewer. Mirrors the client viewer's structure but
 * scoped to the producing side — no sign-off CTA (clerks don't sign;
 * clients do), and the metadata sidebar shows clerk-specific context
 * (payout, client name) instead.
 *
 * Uses `loadClerkJobDetail` so the auth check is the standard "this
 * clerk owns the job, or the caller is an admin viewing it" gate
 * already used by `/clerk/jobs/[id]`.
 */
export default async function ClerkReportDetailPage({ params }: Props) {
  const session = await requireRole('clerk', 'trades', 'admin')
  const { jobId } = await params
  const isAdmin = session.roles.includes('admin')
  const job = await loadClerkJobDetail(jobId, session.userId, isAdmin)
  if (!job) notFound()

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
  const clientLabel =
    job.client?.companyName ?? job.client?.fullName ?? '—'
  const payout = effectiveClerkPayout(job.clerkFinalPayout, job.clerkPayout)

  return (
    <div className="w-full space-y-6 px-6 py-10">
      <Link
        href="/clerk/reports"
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
          href={`/clerk/jobs/${job.id}`}
          className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-2 text-sm font-medium shadow-sm hover:bg-accent"
        >
          Full job context
          <ExternalLink className="h-3.5 w-3.5" />
        </Link>
      </header>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        {/* LEFT — embedded PDF when ready */}
        <div>
          {!isReady ? (
            <Card>
              <CardContent className="space-y-3 py-12 text-center">
                <FileText className="mx-auto h-10 w-10 text-muted-foreground/40" />
                <p className="text-sm font-medium text-foreground">
                  Report not ready yet
                </p>
                <p className="mx-auto max-w-md text-xs text-muted-foreground">
                  This job is still in progress. Once you submit the
                  inspection and admin signs it off, the PDF will
                  appear here.
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
                {/* Same iframe-embed pattern as the client viewer. iOS
                    Safari shows tap-to-open instead of rendering
                    inline; the Download button below is the universal
                    escape hatch. */}
                <iframe
                  src={`/api/reports/${jobId}/view`}
                  title={`Inspection report ${refSlug}`}
                  className="block h-[80vh] w-full border-0 bg-muted/30"
                />
                <div className="flex items-center justify-between gap-3 border-t border-border bg-muted/30 px-4 py-3">
                  <p className="text-xs text-muted-foreground">
                    Trouble viewing? Download and open in your
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

        {/* RIGHT — clerk-side metadata */}
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
              <MetaRow
                icon={<User className="h-3.5 w-3.5 text-muted-foreground" />}
                label="Client"
              >
                {clientLabel}
              </MetaRow>
              {payout > 0 ? (
                <MetaRow
                  icon={
                    <PoundSterling className="h-3.5 w-3.5 text-muted-foreground" />
                  }
                  label="Payout"
                >
                  £{payout.toFixed(2)}
                </MetaRow>
              ) : null}
              {job.deliveredAt ? (
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
