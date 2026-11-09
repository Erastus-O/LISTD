'use client'

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Card, CardContent } from '@/components/ui/card'
import {
  CHART_AXIS,
  CHART_COLORS,
  CHART_GRID,
  ChartEmpty,
  ChartTooltip,
  colorForIndex,
  compactCurrency,
  useChartGradients,
} from '@/components/charts/chart-theme'
import type {
  WorkerChartJobsByStatus,
  WorkerChartJobsByType,
  WorkerChartSpend,
} from '@/lib/dashboard/worker-dashboard-stats'

type Props = {
  spend: WorkerChartSpend
  jobsByType: WorkerChartJobsByType
  jobsByStatus: WorkerChartJobsByStatus
}

/**
 * Three-up charts for /worker/dashboard. Same shared chart theming as
 * the client dashboard at smaller scale, scoped to the worker's own
 * jobs.
 */
export function WorkerDashboardCharts({
  spend,
  jobsByType,
  jobsByStatus,
}: Props) {
  const totalJobs = jobsByType.reduce((n, t) => n + t.value, 0)
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <ChartCard title="Spend: last 6 months">
        <WorkerSpendChart data={spend} />
      </ChartCard>

      <ChartCard title="Jobs by service type (last 90 days)">
        {jobsByType.length === 0 ? (
          <ChartEmpty />
        ) : (
          <div className="relative h-full w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={jobsByType}
                  cx="50%"
                  cy="50%"
                  innerRadius={62}
                  outerRadius={92}
                  dataKey="value"
                  paddingAngle={2}
                  labelLine={false}
                >
                  {jobsByType.map((_, i) => (
                    <Cell
                      key={i}
                      fill={colorForIndex(i)}
                      stroke="#fff"
                      strokeWidth={2}
                    />
                  ))}
                </Pie>
                <Tooltip
                  content={(props) => (
                    <ChartTooltip
                      {...props}
                      formatValue={(v) => v.toLocaleString('en-GB')}
                    />
                  )}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-2xl font-bold text-foreground">
                {totalJobs}
              </span>
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Total
              </span>
            </div>
          </div>
        )}
      </ChartCard>

      <ChartCard title="Jobs by current status">
        {jobsByStatus.length === 0 ? (
          <ChartEmpty />
        ) : (
          <WorkerStatusBarChart data={jobsByStatus} />
        )}
      </ChartCard>
    </div>
  )
}

function ChartCard({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <h3 className="text-sm font-semibold">{title}</h3>
        <div className="h-64">{children}</div>
      </CardContent>
    </Card>
  )
}

function WorkerSpendChart({ data }: { data: WorkerChartSpend }) {
  const { defs, gradFor } = useChartGradients()
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        {defs}
        <CartesianGrid {...CHART_GRID} />
        <XAxis dataKey="month" {...CHART_AXIS} />
        <YAxis {...CHART_AXIS} tickFormatter={compactCurrency} />
        <Tooltip
          cursor={{ stroke: '#CBD5E1', strokeDasharray: '3 3' }}
          content={(props) => (
            <ChartTooltip
              {...props}
              formatName={() => 'Spend'}
              formatValue={(v) => `£${v.toFixed(2)}`}
            />
          )}
        />
        <Area
          type="monotone"
          dataKey="spend"
          stroke={CHART_COLORS[0]}
          strokeWidth={2.5}
          fill={gradFor(0, 'area')}
          activeDot={{ r: 4, strokeWidth: 0, fill: CHART_COLORS[0] }}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}

function WorkerStatusBarChart({ data }: { data: WorkerChartJobsByStatus }) {
  const { defs, gradFor } = useChartGradients()
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical" barCategoryGap="28%">
        {defs}
        <CartesianGrid {...CHART_GRID} horizontal={false} vertical />
        <XAxis type="number" allowDecimals={false} {...CHART_AXIS} />
        <YAxis
          type="category"
          dataKey="status"
          width={120}
          {...CHART_AXIS}
          tickFormatter={(s) => String(s).replace(/_/g, ' ')}
        />
        <Tooltip
          cursor={{ fill: 'rgba(15,23,42,0.04)' }}
          content={(props) => (
            <ChartTooltip {...props} formatName={() => 'Jobs'} hideSwatch />
          )}
        />
        <Bar dataKey="count" fill={gradFor(0, 'bar')} radius={[0, 6, 6, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}
