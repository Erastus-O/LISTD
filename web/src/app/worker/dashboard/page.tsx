import Link from 'next/link'
import {
  Briefcase,
  CheckCircle2,
  CircleDot,
  FileText,
  PlusCircle,
  PoundSterling,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { requireRole } from '@/lib/dal'
import { loadWorkerDashboardStats } from '@/lib/dashboard/worker-dashboard-stats'
import { WorkerDashboardCharts } from './_components/worker-dashboard-charts'

export const metadata = { title: 'Worker · Dashboard' }
export const dynamic = 'force-dynamic'

/**
 * Worker dashboard. Mirrors the client dashboard at smaller scale,
 * scoped to the worker's own jobs (`created_by_user_id = caller`).
 *
 * Owners + admins are bounced to /client/dashboard by the worker layout
 * — they have a richer surface there. This page is the worker's lens on
 * their personal contribution.
 */
export default async function WorkerDashboardPage() {
  const session = await requireRole('client', 'admin')
  const stats = await loadWorkerDashboardStats(session.userId)

  return (
    <div className="w-full space-y-6 px-6 py-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl text-foreground">
            Hi {session.profile?.fullName?.split(' ')[0] ?? 'there'}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Post jobs on behalf of your organisation and track them through to
            sign-off.
          </p>
        </div>
        <Button asChild className="gap-1.5">
          <Link href="/book">
            <PlusCircle className="h-4 w-4" />
            Post a job
          </Link>
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          icon={<Briefcase className="h-4 w-4" />}
          label="Jobs this month"
          value={stats.kpi.jobsThisMonth}
        />
        <Stat
          icon={<PoundSterling className="h-4 w-4" />}
          label="Spend this month"
          value={`£${stats.kpi.spendThisMonth.toFixed(0)}`}
        />
        <Stat
          icon={<CircleDot className="h-4 w-4" />}
          label="Active jobs"
          value={stats.kpi.activeJobs}
        />
        <Stat
          icon={<FileText className="h-4 w-4" />}
          label="Reports delivered"
          value={stats.kpi.reportsDelivered}
        />
      </div>

      <WorkerDashboardCharts
        spend={stats.chart.spend}
        jobsByType={stats.chart.jobsByType}
        jobsByStatus={stats.chart.jobsByStatus}
      />

      <Card>
        <CardContent className="space-y-3 p-6">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold">
            <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
            Recent activity
          </h2>
          {stats.activity.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Nothing yet: once you post a job your activity will appear here.
            </p>
          ) : (
            <ul className="space-y-1.5 text-xs">
              {stats.activity.map((a) => (
                <li key={a.id} className="flex items-start gap-2">
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                  <span className="flex-1">
                    <span className="font-medium text-foreground">
                      {a.action.replace(/_/g, ' ')}
                    </span>
                    {a.targetType && (
                      <span className="ml-1.5 text-muted-foreground">
                        · {a.targetType}
                      </span>
                    )}
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
}: {
  icon: React.ReactNode
  label: string
  value: string | number
}) {
  return (
    <Card>
      <CardContent className="space-y-1.5 p-4">
        <div className="flex items-center gap-2 text-muted-foreground">
          <span className="text-primary">{icon}</span>
          <span className="text-xs">{label}</span>
        </div>
        <p className="text-2xl font-bold text-foreground">{value}</p>
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
