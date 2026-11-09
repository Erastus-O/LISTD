import Link from 'next/link'
import { Eye, Scale } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Pager } from '@/components/admin/pager'
import { requireRole } from '@/lib/dal'
import {
  DISPUTE_BADGE_TONE,
  loadAdminDisputesList,
  parseAdminDisputesFilter,
  type AdminDisputeListRow,
} from '@/lib/dashboard/admin-disputes'
import { AdminDisputesStatusSelect } from './_components/admin-disputes-status-select'

export const metadata = { title: 'Admin · Disputes' }

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

const STATUS_LABELS: Record<string, string> = {
  open: 'Open',
  under_review: 'Under review',
  resolved: 'Resolved',
  escalated: 'Escalated',
}

/**
 * Admin Disputes list (S6d-2). Layout matches the Lovable AdminDisputes
 * table: ID · Job Ref · Property · Raised By · Role · Reason · Status ·
 * Days Open · Actions.
 *
 * Lovable's resolved-statuses (`resolved_client_fault` / `_clerk_fault` /
 * `_shared`) are collapsed into a single `resolved` here — Listd-NEXT never
 * adopted the fault-attribution columns, and the resolution narrative
 * captures intent in free text.
 */
export default async function AdminDisputesPage({ searchParams }: Props) {
  await requireRole('admin')
  const sp = await searchParams
  const filter = parseAdminDisputesFilter(sp)
  const { rows, total, page, pageSize } = await loadAdminDisputesList(filter)
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const pageHref = (n: number) => {
    const next = new URLSearchParams()
    if (filter.status) next.set('status', filter.status)
    if (n > 0) next.set('page', String(n))
    const qs = next.toString()
    return qs ? `/admin/disputes?${qs}` : '/admin/disputes'
  }

  return (
    <div className="w-full space-y-6 px-6 py-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Scale className="h-6 w-6 text-muted-foreground" />
          <h1 className="font-display text-3xl text-foreground">Disputes</h1>
        </div>
        <AdminDisputesStatusSelect />
      </div>

      <p className="text-sm text-muted-foreground">
        {total} {total === 1 ? 'dispute' : 'disputes'}
        {totalPages > 1 ? ` · page ${page + 1} of ${totalPages}` : ''}
      </p>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 text-left font-medium">ID</th>
                  <th className="px-4 py-2.5 text-left font-medium">Job Ref</th>
                  <th className="px-4 py-2.5 text-left font-medium">Property</th>
                  <th className="px-4 py-2.5 text-left font-medium">Raised By</th>
                  <th className="px-4 py-2.5 text-left font-medium">Role</th>
                  <th className="px-4 py-2.5 text-left font-medium">Reason</th>
                  <th className="px-4 py-2.5 text-left font-medium">Status</th>
                  <th className="px-4 py-2.5 text-left font-medium">Days Open</th>
                  <th className="px-4 py-2.5 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={9}
                      className="px-4 py-12 text-center text-sm text-muted-foreground"
                    >
                      No disputes found
                    </td>
                  </tr>
                ) : (
                  rows.map((d) => <DisputeRow key={d.id} dispute={d} />)
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

function DisputeRow({ dispute }: { dispute: AdminDisputeListRow }) {
  const days = daysSince(dispute.createdAt)
  const isResolved = dispute.status === 'resolved'
  const dayClass = isResolved
    ? 'text-muted-foreground'
    : days > 14
      ? 'font-bold text-destructive'
      : days > 7
        ? 'font-medium text-amber-600'
        : ''
  return (
    <tr className="hover:bg-muted/30">
      <td className="px-4 py-2.5">
        <Link
          href={`/admin/disputes/${dispute.id}`}
          className="font-mono text-xs text-primary hover:underline"
        >
          {dispute.id.slice(0, 8)}
        </Link>
      </td>
      <td className="px-4 py-2.5">
        <Link
          href={`/admin/jobs/${dispute.jobId}`}
          className="font-mono text-xs text-primary hover:underline"
        >
          {dispute.jobId.slice(0, 8)}
        </Link>
      </td>
      <td className="max-w-[220px] truncate px-4 py-2.5 text-xs">
        {dispute.property
          ? `${dispute.property.addressLine1 ?? '—'}${
              dispute.property.postcode ? ', ' + dispute.property.postcode : ''
            }`
          : '—'}
      </td>
      <td className="px-4 py-2.5 text-xs">
        {dispute.raisedBy.fullName ?? '—'}
      </td>
      <td className="px-4 py-2.5">
        {dispute.raisedBy.role ? (
          <Badge variant="outline" className="text-[10px] capitalize">
            {dispute.raisedBy.role}
          </Badge>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </td>
      <td className="max-w-[260px] truncate px-4 py-2.5 text-xs">
        {dispute.reason}
      </td>
      <td className="px-4 py-2.5">
        <Badge variant={DISPUTE_BADGE_TONE[dispute.status] ?? 'outline'}>
          {STATUS_LABELS[dispute.status] ?? dispute.status}
        </Badge>
      </td>
      <td className={`px-4 py-2.5 text-xs ${dayClass}`}>
        {isResolved ? `${days}d (resolved)` : `${days}d`}
      </td>
      <td className="px-4 py-2.5 text-right">
        <Link
          href={`/admin/disputes/${dispute.id}`}
          className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-background px-2.5 text-xs transition-colors hover:bg-muted"
        >
          <Eye className="h-3.5 w-3.5" />
          View
        </Link>
      </td>
    </tr>
  )
}

function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24))
}
