import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, ClipboardCheck, FileText, Home, User } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { requireRole } from '@/lib/dal'
import { loadQualityReviewDetail } from '@/lib/dashboard/admin-quality-review'
import { STATUS_BADGE_TONE } from '@/lib/dashboard/admin-jobs'
import {
  INSPECTION_TYPE_LABELS,
  type InspectionType,
} from '@/lib/pricing-matrix'
import { QualityReviewDecisionForm } from './decision-form'

type Props = { params: Promise<{ reportId: string }> }

export const metadata = { title: 'Admin · Review report' }

const REPORT_STATUS_TONE: Record<
  string,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  submitted: 'default',
  approved: 'secondary',
  returned: 'outline',
  rejected: 'destructive',
}

export default async function AdminQualityReviewDetailPage({ params }: Props) {
  await requireRole('admin')
  const { reportId } = await params
  const data = await loadQualityReviewDetail(reportId)
  if (!data) notFound()
  const { report, job, property, clerk, priorAttempts } = data

  const alreadyDecided = report.status !== 'submitted'

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-6 py-10">
      <Link
        href="/admin/quality-review"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to queue
      </Link>

      <div className="flex flex-wrap items-center gap-3">
        <ClipboardCheck className="h-6 w-6 text-muted-foreground" />
        <h1 className="font-mono text-2xl text-foreground">
          {report.id.slice(0, 8)}
        </h1>
        <Badge variant={REPORT_STATUS_TONE[report.status] ?? 'outline'}>
          {report.status}
        </Badge>
        {report.submittedAt && (
          <span className="text-sm text-muted-foreground">
            Submitted {formatDateTime(report.submittedAt)}
          </span>
        )}
      </div>

      {priorAttempts.length > 0 && (
        <Card>
          <CardContent className="space-y-2 p-4 text-xs">
            <p className="font-medium text-amber-700">
              {priorAttempts.length}{' '}
              {priorAttempts.length === 1 ? 'prior attempt' : 'prior attempts'}{' '}
              on this job
            </p>
            <ul className="space-y-1 text-muted-foreground">
              {priorAttempts.slice(0, 3).map((p) => (
                <li key={p.id}>
                  <Badge
                    variant={REPORT_STATUS_TONE[p.status] ?? 'outline'}
                    className="mr-1.5 text-[10px]"
                  >
                    {p.status}
                  </Badge>
                  {p.submittedAt ? formatDateTime(p.submittedAt) : '—'}
                  {p.adminNotes ? ` · ${p.adminNotes}` : ''}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        {/* LEFT — context */}
        <div className="space-y-6">
          {job && (
            <Card>
              <CardContent className="space-y-2 p-6 text-sm">
                <h2 className="flex items-center gap-1.5 text-sm font-semibold">
                  <Home className="h-4 w-4" />
                  Linked job
                </h2>
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

          {clerk && (
            <Card>
              <CardContent className="space-y-2 p-6 text-sm">
                <h2 className="flex items-center gap-1.5 text-sm font-semibold">
                  <User className="h-4 w-4" />
                  Clerk
                </h2>
                <p className="text-sm font-medium">
                  {clerk.fullName ?? '(no name)'}
                </p>
                <p className="text-xs text-muted-foreground">
                  Level {clerk.clerkLevel ?? 1}
                </p>
                <Link
                  href={`/admin/clerks/${clerk.userId}`}
                  className="text-xs text-primary hover:underline"
                >
                  View clerk profile →
                </Link>
              </CardContent>
            </Card>
          )}

          {report.pdfUrl && report.jobId && (
            <Card>
              <CardContent className="space-y-2 p-6 text-sm">
                <h2 className="flex items-center gap-1.5 text-sm font-semibold">
                  <FileText className="h-4 w-4" />
                  Report PDF
                </h2>
                {/* `generated-reports` is a private bucket — the stored
                    `pdfUrl` is a public-form URL that 404s ("Bucket not
                    found"). Link through the view route, which authorizes the
                    admin and 302s to a short-lived signed URL. */}
                <a
                  href={`/api/reports/${report.jobId}/view`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  <FileText className="h-3.5 w-3.5" />
                  Open PDF in new tab
                </a>
                <p className="text-[11px] text-muted-foreground">
                  Inspection-data review (room-by-room) lands when the
                  report-viewer surface ports. For now reviewers download
                  the PDF and decide based on it.
                </p>
              </CardContent>
            </Card>
          )}

          {report.adminNotes && alreadyDecided && (
            <Card>
              <CardContent className="space-y-2 p-6 text-sm">
                <h2 className="text-sm font-semibold">Reviewer notes</h2>
                <p className="whitespace-pre-line">{report.adminNotes}</p>
              </CardContent>
            </Card>
          )}
        </div>

        {/* RIGHT — decision form */}
        <div>
          <QualityReviewDecisionForm
            reportId={report.id}
            alreadyDecided={alreadyDecided}
            initialNotes={report.adminNotes}
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
