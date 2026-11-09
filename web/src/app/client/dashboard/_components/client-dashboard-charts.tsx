'use client'

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
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
  CHART_NEUTRAL_OTHER,
  ChartEmpty,
  ChartTooltip,
  colorForIndex,
  compactCurrency,
  useChartGradients,
} from '@/components/charts/chart-theme'
import type {
  ClientChartByWorker,
  ClientChartJobsByStatus,
  ClientChartJobsByType,
  ClientChartSpend,
} from '@/lib/dashboard/client-dashboard-stats'

type Props = {
  spend: ClientChartSpend
  jobsByType: ClientChartJobsByType
  jobsByStatus: ClientChartJobsByStatus
  byWorker: ClientChartByWorker | null
}

/**
 * Client dashboard charts — refreshed with the shared chart theming
 * primitives (gradient fills, custom tooltip, lighter grid, rounded
 * corners). Three cards across:
 *   1. Spend over time (area chart with gradient; stacked-by-worker
 *      bars for org owners)
 *   2. Jobs by service type (donut with centred total; stacked bar by
 *      worker for org owners)
 *   3. Jobs by current status (rounded horizontal bar)
 */
export function ClientDashboardCharts({
  spend,
  jobsByType,
  jobsByStatus,
  byWorker,
}: Props) {
  const hasWorkers = byWorker !== null && byWorker.workers.length > 0
  const totalJobsByType = jobsByType.reduce((n, t) => n + t.value, 0)
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <ChartCard
        title={
          hasWorkers
            ? 'Spend by worker : last 6 months'
            : 'Spend: last 6 months'
        }
      >
        {hasWorkers ? (
          <SpendByWorkerChart data={byWorker} />
        ) : (
          <SpendAreaChart data={spend} />
        )}
      </ChartCard>

      <ChartCard
        title={
          hasWorkers
            ? 'Jobs by service type & worker (last 90 days)'
            : 'Jobs by service type (last 90 days)'
        }
      >
        {hasWorkers ? (
          byWorker.jobsByType.length === 0 ? (
            <ChartEmpty />
          ) : (
            <TypeByWorkerChart data={byWorker} />
          )
        ) : jobsByType.length === 0 ? (
          <ChartEmpty />
        ) : (
          <DonutWithTotal data={jobsByType} total={totalJobsByType} />
        )}
      </ChartCard>

      <ChartCard title="Jobs by current status">
        {jobsByStatus.length === 0 ? (
          <ChartEmpty />
        ) : (
          <StatusBarChart data={jobsByStatus} />
        )}
      </ChartCard>
    </div>
  )
}

function DonutWithTotal({
  data,
  total,
}: {
  data: ClientChartJobsByType
  total: number
}) {
  return (
    <div className="relative h-full w-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={62}
            outerRadius={92}
            dataKey="value"
            paddingAngle={2}
            labelLine={false}
          >
            {data.map((_, i) => (
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
        <span className="text-2xl font-bold text-foreground">{total}</span>
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
          Total
        </span>
      </div>
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

function workerLabel(
  key: string | undefined,
  workers: ClientChartByWorker['workers']
): string {
  if (!key) return ''
  if (key === 'other') return 'Other'
  const match = workers.find((w) => w.userId === key)
  return match?.fullName ?? '(unnamed)'
}

function SpendByWorkerChart({ data }: { data: ClientChartByWorker }) {
  const { defs, gradFor } = useChartGradients()
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data.spend} barCategoryGap="22%">
        {defs}
        <CartesianGrid {...CHART_GRID} />
        <XAxis dataKey="month" {...CHART_AXIS} />
        <YAxis {...CHART_AXIS} tickFormatter={compactCurrency} />
        <Tooltip
          cursor={{ fill: 'rgba(15,23,42,0.04)' }}
          content={(props) => (
            <ChartTooltip
              {...props}
              formatName={(name) => workerLabel(name, data.workers)}
              formatValue={(v) => `£${v.toFixed(0)}`}
            />
          )}
        />
        <Legend
          formatter={(value: string) => workerLabel(value, data.workers)}
          wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
          iconType="circle"
        />
        {data.workers.map((w, i) => (
          <Bar
            key={w.userId}
            dataKey={w.userId}
            stackId="spend"
            fill={gradFor(i, 'bar')}
            radius={[6, 6, 0, 0]}
          />
        ))}
        <Bar
          dataKey="other"
          stackId="spend"
          fill={CHART_NEUTRAL_OTHER}
          radius={[6, 6, 0, 0]}
        />
      </BarChart>
    </ResponsiveContainer>
  )
}

function SpendAreaChart({ data }: { data: ClientChartSpend }) {
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

function TypeByWorkerChart({ data }: { data: ClientChartByWorker }) {
  const { defs, gradFor } = useChartGradients()
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data.jobsByType} layout="vertical">
        {defs}
        <CartesianGrid {...CHART_GRID} horizontal={false} vertical />
        <XAxis type="number" allowDecimals={false} {...CHART_AXIS} />
        <YAxis type="category" dataKey="type" width={130} {...CHART_AXIS} />
        <Tooltip
          cursor={{ fill: 'rgba(15,23,42,0.04)' }}
          content={(props) => (
            <ChartTooltip
              {...props}
              formatName={(name) => workerLabel(name, data.workers)}
            />
          )}
        />
        <Legend
          formatter={(value: string) => workerLabel(value, data.workers)}
          wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
          iconType="circle"
        />
        {data.workers.map((w, i) => (
          <Bar
            key={w.userId}
            dataKey={w.userId}
            stackId="type"
            fill={gradFor(i, 'bar')}
          />
        ))}
        <Bar dataKey="other" stackId="type" fill={CHART_NEUTRAL_OTHER} />
      </BarChart>
    </ResponsiveContainer>
  )
}

function StatusBarChart({ data }: { data: ClientChartJobsByStatus }) {
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
