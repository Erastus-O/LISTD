import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ArrowLeft, Briefcase, FileText, PoundSterling } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { ProfileAvatar } from '@/components/role/profile-avatar'
import { requireRole } from '@/lib/dal'
import { loadCallerMembership } from '@/lib/dashboard/client-workers'
import { loadWorkerDetail } from '@/lib/dashboard/worker-detail'
import {
  INSPECTION_TYPE_LABELS,
  type InspectionType,
} from '@/lib/pricing-matrix'
import { WorkerSpendTrendCard } from './_components/worker-spend-trend-card'

export const metadata = { title: 'Worker · Detail' }
export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ workerId: string }> }

/**
 * Per-worker drill-down for the org owner. Gated:
 *   - Caller must be active org owner (or admin).
 *   - Target must belong to the same org.
 *
 * Surfaces profile + stats + recent jobs + recent reports + 6-month spend
 * trend + activity feed. Each section is independently empty-state-safe
 * so a brand-new worker still renders cleanly.
 */
export default async function WorkerDetailPage({ params }: Props) {
  const session = await requireRole('client', 'admin')
  const { workerId } = await params
  const membership = await loadCallerMembership(session.userId)
  const isAdmin = session.roles.includes('admin')
  if (!isAdmin && (!membership || membership.orgRole !== 'owner')) {
    redirect('/client/team')
  }
  const orgId = membership?.organisationId ?? null
  if (!orgId) notFound()
  const detail = await loadWorkerDetail(orgId, workerId)
  if (!detail) notFound()

  return (
    <div className="w-full space-y-6 px-6 py-10">
      <Link
        href="/client/team"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to team
      </Link>

      <div className="flex flex-wrap items-center gap-4">
        <ProfileAvatar
          url={detail.avatarUrl}
          name={detail.fullName}
          emailFallback={detail.email}
          size="lg"
        />
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-3xl text-foreground">
            {detail.fullName ?? '(no name)'}
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>{detail.email ?? '—'}</span>
            {detail.phone && <span>· {detail.phone}</span>}
            <Badge
              variant={detail.status === 'active' ? 'secondary' : 'outline'}
              className="capitalize"
            >
              {detail.status}
            </Badge>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          icon={<Briefcase className="h-4 w-4" />}
          label="Jobs posted"
          value={detail.stats.jobsPosted}
        />
        <Stat
          icon={<PoundSterling className="h-4 w-4" />}
          label="Total spend"
          value={`£${detail.stats.totalSpend.toFixed(0)}`}
        />
        <Stat
          icon={<Briefcase className="h-4 w-4" />}
          label="Active jobs"
          value={detail.stats.activeJobs}
        />
        <Stat
          icon={<FileText className="h-4 w-4" />}
          label="Reports delivered"
          value={detail.stats.reportsDelivered}
          subtitle={
            detail.stats.completionRatePercent !== null
              ? `${detail.stats.completionRatePercent}% completion`
              : undefined
          }
        />
      </div>

      <WorkerSpendTrendCard data={detail.spendTrend} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardContent className="space-y-3 p-4">
            <h2 className="text-sm font-semibold">Recent jobs</h2>
            {detail.recentJobs.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No jobs yet.
              </p>
            ) : (
              <table className="w-full text-xs">
                <thead className="border-b border-border text-[10px] uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-2 py-2 text-left font-medium">Ref</th>
                    <th className="px-2 py-2 text-left font-medium">Property</th>
                    <th className="px-2 py-2 text-left font-medium">Type</th>
                    <th className="px-2 py-2 text-left font-medium">Status</th>
                    <th className="px-2 py-2 text-right font-medium">Quoted</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {detail.recentJobs.map((j) => (
                    <tr key={j.id} className="hover:bg-muted/30">
                      <td className="px-2 py-2">
                        <Link
                          href={`/client/jobs/${j.id}`}
                          className="font-mono text-[11px] text-primary hover:underline"
                        >
                          {j.id.slice(0, 8)}
                        </Link>
                      </td>
                      <td className="max-w-[180px] truncate px-2 py-2 text-[11px]">
                        {j.propertyAddress
                          ? `${j.propertyAddress}${j.propertyPostcode ? ', ' + j.propertyPostcode : ''}`
                          : '—'}
                      </td>
                      <td className="px-2 py-2 text-[11px]">
                        {INSPECTION_TYPE_LABELS[
                          j.inspectionType as InspectionType
                        ] ?? j.inspectionType}
                      </td>
                      <td className="px-2 py-2 text-[11px]">
                        {j.status.replace(/_/g, ' ')}
                      </td>
                      <td className="px-2 py-2 text-right text-[11px]">
                        {j.quotedPrice
                          ? `£${Number(j.quotedPrice).toFixed(0)}`
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-3 p-4">
            <h2 className="text-sm font-semibold">Recent reports</h2>
            {detail.recentReports.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No reports yet.
              </p>
            ) : (
              <ul className="space-y-2">
                {detail.recentReports.map((r) => (
                  <li
                    key={r.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-2 text-xs"
                  >
                    <div className="min-w-0">
                      <Link
                        href={`/client/jobs/${r.id}`}
                        className="font-mono text-[11px] text-primary hover:underline"
                      >
                        {r.id.slice(0, 8)}
                      </Link>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {r.propertyAddress ?? '—'}
                      </p>
                    </div>
                    {r.reportUrl && (
                      <a
                        href={`/api/reports/${r.id}/view`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[11px] text-primary hover:underline"
                      >
                        Open PDF
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="space-y-3 p-4">
          <h2 className="text-sm font-semibold">Recent activity</h2>
          {detail.activity.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No activity captured yet.
            </p>
          ) : (
            <ul className="space-y-1.5 text-xs">
              {detail.activity.map((a) => (
                <li key={a.id} className="flex items-start gap-2">
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                  <span className="flex-1">
                    <span className="font-medium text-foreground">
                      {a.action.replace(/_/g, ' ')}
                    </span>
                    <span className="ml-1.5 text-muted-foreground">
                      {a.targetType ? `· ${a.targetType}` : ''}
                    </span>
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {formatDateTime(a.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function Stat({
  icon,
  label,
  value,
  subtitle,
}: {
  icon: React.ReactNode
  label: string
  value: string | number
  subtitle?: string
}) {
  return (
    <Card>
      <CardContent className="space-y-1 p-4">
        <div className="flex items-center gap-2 text-muted-foreground">
          <span className="text-primary">{icon}</span>
          <span className="text-xs">{label}</span>
        </div>
        <p className="text-2xl font-bold text-foreground">{value}</p>
        {subtitle && (
          <p className="text-[11px] text-muted-foreground">{subtitle}</p>
        )}
      </CardContent>
    </Card>
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
