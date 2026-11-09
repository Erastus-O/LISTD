'use client'

import {
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

type Props = {
  monthlyData: Array<{ month: string; jobs: number; earnings: number }>
  inspectionTypeBreakdown: Array<{ type: string; count: number }>
}

const PIE_COLORS = [
  'var(--live)',
  'var(--brand)',
  'hsl(36 100% 50%)',
  'hsl(150 70% 45%)',
  'hsl(0 70% 50%)',
]

/**
 * Single client island for the clerk dashboard's two recharts surfaces.
 * Server pre-bakes the datasets in [clerk-dashboard.ts](../../../lib/dashboard/clerk-dashboard.ts),
 * so this component is purely presentational.
 */
export function ClerkDashboardCharts({
  monthlyData,
  inspectionTypeBreakdown,
}: Props) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardContent className="space-y-2 p-4">
          <div>
            <h3 className="text-sm font-semibold">Earnings overview</h3>
            <p className="text-[11px] text-muted-foreground">
              Last 6 months performance
            </p>
          </div>
          <div className="h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlyData} barGap={4}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  vertical={false}
                  stroke="var(--border)"
                />
                <XAxis
                  dataKey="month"
                  tick={{ fontSize: 11, fill: 'var(--text-muted)' }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: 'var(--text-muted)' }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => `£${v}`}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'var(--surface)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  formatter={(value: number, name: string) => [
                    name === 'earnings' ? `£${value}` : value,
                    name === 'earnings' ? 'Earnings' : 'Jobs',
                  ]}
                />
                <Bar
                  dataKey="earnings"
                  fill="var(--live)"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={32}
                />
                <Bar
                  dataKey="jobs"
                  fill="var(--brand)"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={32}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-2 p-4">
          <div>
            <h3 className="text-sm font-semibold">Inspection types</h3>
            <p className="text-[11px] text-muted-foreground">
              Breakdown by category
            </p>
          </div>
          <div className="h-[220px]">
            {inspectionTypeBreakdown.length === 0 ? (
              <div className="flex h-full items-center justify-center text-[11px] text-muted-foreground">
                No inspection data yet
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={inspectionTypeBreakdown}
                    dataKey="count"
                    nameKey="type"
                    cx="50%"
                    cy="45%"
                    outerRadius={65}
                    innerRadius={35}
                    paddingAngle={3}
                    strokeWidth={0}
                  >
                    {inspectionTypeBreakdown.map((_, i) => (
                      <Cell
                        key={i}
                        fill={PIE_COLORS[i % PIE_COLORS.length]}
                      />
                    ))}
                  </Pie>
                  <Legend
                    verticalAlign="bottom"
                    iconSize={8}
                    iconType="circle"
                    formatter={(value) => (
                      <span
                        style={{
                          fontSize: 10,
                          color: 'var(--text-muted)',
                        }}
                      >
                        {value}
                      </span>
                    )}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'var(--surface)',
                      border: '1px solid var(--border)',
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
