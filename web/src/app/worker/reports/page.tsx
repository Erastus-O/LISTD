import Link from 'next/link'
import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm'
import { Download, Eye, FileText } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { db, jobs, properties } from '@/db'
import { requireRole } from '@/lib/dal'
import {
  INSPECTION_TYPE_LABELS,
  type InspectionType,
} from '@/lib/pricing-matrix'

export const metadata = { title: 'Worker · Reports' }
export const dynamic = 'force-dynamic'

const REPORT_STATUSES = [
  'submitted',
  'reviewed',
  'signed',
  'completed',
  'paid',
] as const

/**
 * Worker's own delivered reports. Scoped to jobs they personally posted —
 * the org owner sees the wider org report set on `/client/reports`.
 */
export default async function WorkerReportsPage() {
  const session = await requireRole('client', 'admin')
  const rows = await db
    .select({
      jobId: jobs.id,
      inspectionType: jobs.inspectionType,
      status: jobs.status,
      reportUrl: jobs.reportUrl,
      scheduledDate: jobs.scheduledDate,
      addressLine1: properties.addressLine1,
      city: properties.city,
      postcode: properties.postcode,
    })
    .from(jobs)
    .leftJoin(properties, eq(properties.id, jobs.propertyId))
    .where(
      and(
        eq(jobs.createdByUserId, session.userId),
        isNotNull(jobs.reportUrl),
        inArray(jobs.status, [...REPORT_STATUSES])
      )
    )
    .orderBy(desc(jobs.scheduledDate))
    .limit(100)

  return (
    <div className="w-full space-y-6 px-6 py-10">
      <div className="flex items-center gap-2">
        <FileText className="h-6 w-6 text-muted-foreground" />
        <div>
          <h1 className="font-display text-3xl text-foreground">My reports</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            {rows.length} {rows.length === 1 ? 'report' : 'reports'} delivered
          </p>
        </div>
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No reports yet: they&apos;ll appear here as clerks submit them.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <Card key={r.jobId}>
              <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <Link
                    href={`/client/jobs/${r.jobId}`}
                    className="font-mono text-xs text-primary hover:underline"
                  >
                    {r.jobId.slice(0, 8)}
                  </Link>
                  <Badge variant="secondary" className="text-xs">
                    {r.status.replace(/_/g, ' ')}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {INSPECTION_TYPE_LABELS[
                      r.inspectionType as InspectionType
                    ] ?? r.inspectionType}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {r.addressLine1
                      ? `${r.addressLine1}${r.postcode ? ', ' + r.postcode : ''}`
                      : '—'}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {r.reportUrl && (
                    <a
                      href={`/api/reports/${r.jobId}/view`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex h-8 items-center gap-1 rounded-md border border-border bg-background px-3 text-xs transition-colors hover:bg-muted"
                    >
                      <Download className="h-3.5 w-3.5" />
                      PDF
                    </a>
                  )}
                  <Link
                    href={`/worker/reports/${r.jobId}`}
                    className="inline-flex h-8 items-center gap-1 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90"
                  >
                    <Eye className="h-3.5 w-3.5" />
                    View
                  </Link>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
