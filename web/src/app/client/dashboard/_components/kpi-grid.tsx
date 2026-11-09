import {
  Briefcase,
  CircleDot,
  FileText,
  PoundSterling,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import type { ClientDashboardKpi } from '@/lib/dashboard/client-dashboard-stats'

/**
 * Four headline KPI cards across the top of the client dashboard. Drives
 * the "what should I look at first" glance pass; the charts below answer
 * "what's changed over time".
 */
export function ClientKpiGrid({ kpi }: { kpi: ClientDashboardKpi }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <KpiCard
        icon={<Briefcase className="h-4 w-4" />}
        label="Jobs this month"
        value={kpi.jobsThisMonth}
      />
      <KpiCard
        icon={<PoundSterling className="h-4 w-4" />}
        label="Spend this month"
        value={`£${kpi.spendThisMonth.toFixed(0)}`}
      />
      <KpiCard
        icon={<CircleDot className="h-4 w-4" />}
        label="Active jobs"
        value={kpi.activeJobs}
      />
      <KpiCard
        icon={<FileText className="h-4 w-4" />}
        label="Reports awaiting sign-off"
        value={kpi.reportsAwaitingSignoff}
        alert={kpi.reportsAwaitingSignoff > 0}
      />
    </div>
  )
}

function KpiCard({
  icon,
  label,
  value,
  alert,
}: {
  icon: React.ReactNode
  label: string
  value: string | number
  alert?: boolean
}) {
  return (
    <Card className={alert ? 'border-amber-500/40' : ''}>
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
