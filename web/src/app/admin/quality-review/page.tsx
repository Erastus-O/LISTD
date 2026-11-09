import Link from 'next/link'
import { ClipboardCheck, Eye } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Pager } from '@/components/admin/pager'
import { requireRole } from '@/lib/dal'
import {
  loadQualityReviewQueue,
  parseQualityReviewFilter,
} from '@/lib/dashboard/admin-quality-review'
import {
  INSPECTION_TYPE_LABELS,
  type InspectionType,
} from '@/lib/pricing-matrix'

export const metadata = { title: 'Admin · Quality Review' }
export const dynamic = 'force-dynamic'

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

/**
 * Admin Quality Review queue (S6d-3). Layout matches the Lovable
 * AdminQualityReview table: Job Ref · Property Address · Clerk · Service
 * Type · Submitted · Time in Queue · Actions.
 *
 * Lists every `reports.status='submitted'` row, oldest first. Hours-in-queue
 * is colour-coded (>2h amber, >4h red) — same SLA targets the Lovable
 * surface tracked. Click-through opens the decision page where the
 * audit-wired approve/return/reject lifecycle actions live.
 *
 * `force-dynamic` so admins always see the current queue (no ISR cache).
 */
export default async function AdminQualityReviewPage({ searchParams }: Props) {
  await requireRole('admin')
  const sp = await searchParams
  const filter = parseQualityReviewFilter(sp)
  const { items: queue, total, page, pageSize } = await loadQualityReviewQueue(filter)
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const pageHref = (n: number) =>
    n > 0 ? `/admin/quality-review?page=${n}` : '/admin/quality-review'

  return (
    <div className="w-full space-y-6 px-6 py-10">
      <div>
        <div className="flex items-center gap-2">
          <ClipboardCheck className="h-6 w-6 text-muted-foreground" />
          <h1 className="font-display text-3xl text-foreground">
            Quality Review Queue
          </h1>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {total} {total === 1 ? 'report' : 'reports'} pending review
          {totalPages > 1 ? ` · page ${page + 1} of ${totalPages}` : ''}
        </p>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 text-left font-medium">Job Ref</th>
                  <th className="px-4 py-2.5 text-left font-medium">
                    Property Address
                  </th>
                  <th className="px-4 py-2.5 text-left font-medium">Pro</th>
                  <th className="px-4 py-2.5 text-left font-medium">
                    Service Type
                  </th>
                  <th className="px-4 py-2.5 text-left font-medium">Submitted</th>
                  <th className="px-4 py-2.5 text-left font-medium">
                    Time in Queue
                  </th>
                  <th className="px-4 py-2.5 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {queue.length === 0 ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-4 py-12 text-center text-sm text-muted-foreground"
                    >
                      No reports pending review: all caught up! 🎉
                    </td>
                  </tr>
                ) : (
                  queue.map((q) => {
                    const hours = hoursInQueue(q.submittedAt)
                    const queueTone =
                      hours > 4
                        ? 'font-bold text-destructive'
                        : hours > 2
                          ? 'font-medium text-amber-600'
                          : 'text-muted-foreground'
                    return (
                      <tr key={q.reportId} className="hover:bg-muted/30">
                        <td className="px-4 py-2.5">
                          <Link
                            href={`/admin/quality-review/${q.reportId}`}
                            className="font-mono text-xs text-primary hover:underline"
                          >
                            {q.jobId ? q.jobId.slice(0, 8) : '—'}
                          </Link>
                        </td>
                        <td className="max-w-[260px] truncate px-4 py-2.5 text-xs">
                          {q.property
                            ? `${q.property.addressLine1 ?? ''}${
                                q.property.postcode
                                  ? ', ' + q.property.postcode
                                  : ''
                              }`
                            : '—'}
                        </td>
                        <td className="px-4 py-2.5 text-xs">
                          {q.clerk?.fullName ?? '—'}
                        </td>
                        <td className="px-4 py-2.5 text-xs">
                          {INSPECTION_TYPE_LABELS[
                            q.inspectionType as InspectionType
                          ] ?? q.inspectionType}
                        </td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground">
                          {q.submittedAt ? formatDateTime(q.submittedAt) : '—'}
                        </td>
                        <td className={`px-4 py-2.5 text-xs ${queueTone}`}>
                          {q.submittedAt ? `${hours}h` : '—'}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <Link
                            href={`/admin/quality-review/${q.reportId}`}
                            className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-background px-2.5 text-xs transition-colors hover:bg-muted"
                          >
                            <Eye className="h-3.5 w-3.5" />
                            Review
                          </Link>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Pager page={page} totalPages={totalPages} href={pageHref} />
    </div>
  )
}

function hoursInQueue(submittedAt: string | null): number {
  if (!submittedAt) return 0
  return Math.floor(
    (Date.now() - new Date(submittedAt).getTime()) / (1000 * 60 * 60)
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
