import Link from 'next/link'
import { Download, FilePlus2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Pager } from '@/components/admin/pager'
import { requireRole } from '@/lib/dal'
import {
  loadAdminReports,
  parseAdminReportsFilter,
  type AdminReportRow,
} from '@/lib/dashboard/admin-reports'
import {
  INSPECTION_TYPE_LABELS,
  type InspectionType,
} from '@/lib/pricing-matrix'
import { ReplaceReportButton } from './_components/replace-report-button'
import { ShareReportButton } from './_components/share-report-button'

export const metadata = { title: 'Admin · Reports' }
export const dynamic = 'force-dynamic'

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

const STATUS_TONE: Record<
  string,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  submitted: 'default',
  reviewed: 'secondary',
  signed: 'secondary',
  completed: 'secondary',
  paid: 'secondary',
}

/**
 * Admin Reports management page.
 *
 * Clerks generate the source PDF via the inspection wizard at
 * [/clerk/jobs/[jobId]/inspect](../../clerk/jobs/[jobId]/inspect/page.tsx);
 * the signed-PDF re-render fires on tenant sign-off via
 * [signed-pdf-pipeline.ts](../../../lib/signed-pdf-pipeline.ts). This page
 * is the admin's **PDF management** surface — browsing reports, opening
 * the current PDF, and replacing it when something's wrong (corrupt
 * upload, redaction). Replacement supersedes `jobs.report_url` and writes
 * a `tenant_portal_access/signed_pdf.replaced` audit row.
 */
export default async function AdminGenerateReportPage({ searchParams }: Props) {
  await requireRole('admin')
  const sp = await searchParams
  const filter = parseAdminReportsFilter(sp)
  const { rows, total, page, pageSize } = await loadAdminReports(filter)
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const pageHref = (n: number) =>
    n > 0 ? `/admin/generate-report?page=${n}` : '/admin/generate-report'

  return (
    <div className="w-full space-y-6 px-6 py-10">
      <div className="flex items-center gap-2">
        <FilePlus2 className="h-6 w-6 text-muted-foreground" />
        <div>
          <h1 className="font-display text-3xl text-foreground">Reports</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Manage delivered report PDFs · {total}{' '}
            {total === 1 ? 'report' : 'reports'}
            {totalPages > 1 ? ` · page ${page + 1} of ${totalPages}` : ''}
          </p>
        </div>
      </div>

      <Card>
        <CardContent className="space-y-2 p-4 text-xs text-muted-foreground">
          <p>
            Reports are uploaded by clerks at submission and re-rendered with
            embedded signatures when tenants sign off. Replace a PDF here only
            when the file itself needs to change (corrupt upload, redaction).
            All replacements are audited.
          </p>
          <p>
            For QA review of newly submitted reports, head to{' '}
            <Link
              href="/admin/quality-review"
              className="text-primary hover:underline"
            >
              Quality Review
            </Link>
            .
          </p>
        </CardContent>
      </Card>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No reports delivered yet.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <ReportCard key={r.jobId} row={r} />
          ))}
        </div>
      )}

      <Pager page={page} totalPages={totalPages} href={pageHref} />
    </div>
  )
}

function ReportCard({ row }: { row: AdminReportRow }) {
  const refSlug = row.jobId.slice(0, 8)
  const inspectionLabel =
    INSPECTION_TYPE_LABELS[row.inspectionType as InspectionType] ??
    row.inspectionType
  const address = row.property
    ? `${row.property.addressLine1 ?? ''}${
        row.property.postcode ? ', ' + row.property.postcode : ''
      }`
    : '—'
  const clientLabel =
    row.client?.companyName ?? row.client?.fullName ?? '—'

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/admin/jobs/${row.jobId}`}
              className="font-mono text-xs text-primary hover:underline"
            >
              {refSlug}
            </Link>
            <Badge variant={STATUS_TONE[row.status] ?? 'outline'}>
              {row.status.replace(/_/g, ' ')}
            </Badge>
            <span className="text-xs text-muted-foreground">
              {inspectionLabel}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {row.reportUrl && (
              <a
                href={`/api/reports/${row.jobId}/view`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-8 items-center gap-1 rounded-md border border-border bg-background px-3 text-xs transition-colors hover:bg-muted"
              >
                <Download className="h-3.5 w-3.5" />
                Open
              </a>
            )}
            {row.reportUrl && <ShareReportButton jobId={row.jobId} />}
            <ReplaceReportButton jobId={row.jobId} />
          </div>
        </div>
        <div className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-3">
          <Detail label="Property">{address}</Detail>
          <Detail label="Client">{clientLabel}</Detail>
          <Detail label="Clerk">{row.clerk?.fullName ?? '—'}</Detail>
        </div>
      </CardContent>
    </Card>
  )
}

function Detail({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="text-foreground">{children}</p>
    </div>
  )
}
