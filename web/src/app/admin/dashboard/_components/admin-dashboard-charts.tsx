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

type Props = {
  jobsByDay: Array<{ date: string; count: number }>
  jobsByType: Array<{ name: string; value: number }>
  revenueByDay: Array<{ date: string; revenue: number }>
  topClients: Array<{ name: string; count: number }>
  topClientsByRevenue: Array<{ name: string; revenue: number }>
  topClerks: Array<{ name: string; count: number }>
}

/**
 * Single client island bundling the admin dashboard charts. Server
 * pre-bakes the datasets in `lib/dashboard/admin-dashboard.ts` so this
 * component is purely presentational. Uses the shared chart-theme
 * primitives — gradient fills, custom tooltip, lighter grid, rounded
 * bars — so admin/client/worker dashboards all look like they belong to
 * the same product.
 */
export function AdminDashboardCharts({
  jobsByDay,
  jobsByType,
  revenueByDay,
  topClients,
  topClientsByRevenue,
  topClerks,
}: Props) {
  const totalJobsByType = jobsByType.reduce((n, t) => n + t.value, 0)
  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-3">
        <ChartCard title="Jobs posted: last 30 days">
          <JobsPostedChart data={jobsByDay} />
        </ChartCard>

        <ChartCard title="Jobs by service type">
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
                  {totalJobsByType}
                </span>
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Total
                </span>
              </div>
            </div>
          )}
        </ChartCard>

        <ChartCard title="Revenue: last 30 days">
          <RevenueChart data={revenueByDay} />
        </ChartCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <ChartCard title="Top 5 clients by revenue">
          {topClientsByRevenue.length === 0 ? (
            <ChartEmpty />
          ) : (
            <HorizontalRevenueChart data={topClientsByRevenue} colorIndex={2} />
          )}
        </ChartCard>

        <ChartCard title="Top 5 clients by volume">
          {topClients.length === 0 ? (
            <ChartEmpty />
          ) : (
            <HorizontalCountChart
              data={topClients}
              colorIndex={0}
              seriesLabel="Jobs"
            />
          )}
        </ChartCard>

        <ChartCard title="Top 5 clerks by completed jobs">
          {topClerks.length === 0 ? (
            <ChartEmpty />
          ) : (
            <HorizontalCountChart
              data={topClerks}
              colorIndex={1}
              seriesLabel="Completed"
            />
          )}
        </ChartCard>
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
        <div className="h-72">{children}</div>
      </CardContent>
    </Card>
  )
}

function JobsPostedChart({
  data,
}: {
  data: Array<{ date: string; count: number }>
}) {
  const { defs, gradFor } = useChartGradients()
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} barCategoryGap="20%">
        {defs}
        <CartesianGrid {...CHART_GRID} />
        <XAxis dataKey="date" {...CHART_AXIS} interval={4} />
        <YAxis allowDecimals={false} {...CHART_AXIS} />
        <Tooltip
          cursor={{ fill: 'rgba(15,23,42,0.04)' }}
          content={(props) => (
            <ChartTooltip
              {...props}
              formatName={() => 'Jobs posted'}
              hideSwatch
            />
          )}
        />
        <Bar dataKey="count" fill={gradFor(0, 'bar')} radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}

function RevenueChart({
  data,
}: {
  data: Array<{ date: string; revenue: number }>
}) {
  const { defs, gradFor } = useChartGradients()
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        {defs}
        <CartesianGrid {...CHART_GRID} />
        <XAxis dataKey="date" {...CHART_AXIS} interval={4} />
        <YAxis {...CHART_AXIS} tickFormatter={compactCurrency} />
        <Tooltip
          cursor={{ stroke: '#CBD5E1', strokeDasharray: '3 3' }}
          content={(props) => (
            <ChartTooltip
              {...props}
              formatName={() => 'Revenue'}
              formatValue={(v) => `£${v.toFixed(2)}`}
            />
          )}
        />
        <Area
          type="monotone"
          dataKey="revenue"
          stroke={CHART_COLORS[0]}
          strokeWidth={2.5}
          fill={gradFor(0, 'area')}
          activeDot={{ r: 4, strokeWidth: 0, fill: CHART_COLORS[0] }}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}

function HorizontalRevenueChart({
  data,
  colorIndex,
}: {
  data: Array<{ name: string; revenue: number }>
  colorIndex: number
}) {
  const { defs, gradFor } = useChartGradients()
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical" barCategoryGap="28%">
        {defs}
        <CartesianGrid {...CHART_GRID} horizontal={false} vertical />
        <XAxis type="number" {...CHART_AXIS} tickFormatter={compactCurrency} />
        <YAxis type="category" dataKey="name" width={130} {...CHART_AXIS} />
        <Tooltip
          cursor={{ fill: 'rgba(15,23,42,0.04)' }}
          content={(props) => (
            <ChartTooltip
              {...props}
              formatName={() => 'Revenue'}
              formatValue={(v) => `£${v.toFixed(2)}`}
              hideSwatch
            />
          )}
        />
        <Bar
          dataKey="revenue"
          fill={gradFor(colorIndex, 'bar')}
          radius={[0, 6, 6, 0]}
        />
      </BarChart>
    </ResponsiveContainer>
  )
}

function HorizontalCountChart({
  data,
  colorIndex,
  seriesLabel,
}: {
  data: Array<{ name: string; count: number }>
  colorIndex: number
  seriesLabel: string
}) {
  const { defs, gradFor } = useChartGradients()
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical" barCategoryGap="28%">
        {defs}
        <CartesianGrid {...CHART_GRID} horizontal={false} vertical />
        <XAxis type="number" allowDecimals={false} {...CHART_AXIS} />
        <YAxis type="category" dataKey="name" width={130} {...CHART_AXIS} />
        <Tooltip
          cursor={{ fill: 'rgba(15,23,42,0.04)' }}
          content={(props) => (
            <ChartTooltip
              {...props}
              formatName={() => seriesLabel}
              hideSwatch
            />
          )}
        />
        <Bar
          dataKey="count"
          fill={gradFor(colorIndex, 'bar')}
          radius={[0, 6, 6, 0]}
        />
      </BarChart>
    </ResponsiveContainer>
  )
}
