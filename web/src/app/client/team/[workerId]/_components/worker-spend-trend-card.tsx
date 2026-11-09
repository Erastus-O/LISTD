'use client'

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { TrendingUp } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import {
  CHART_AXIS,
  CHART_COLORS,
  CHART_GRID,
  ChartTooltip,
  compactCurrency,
  useChartGradients,
} from '@/components/charts/chart-theme'
import type { WorkerSpendPoint } from '@/lib/dashboard/worker-detail'

type Props = { data: WorkerSpendPoint[] }

/**
 * 6-month spend trend for a single worker, rendered as a gradient area.
 * Hidden when every value is zero.
 */
export function WorkerSpendTrendCard({ data }: Props) {
  const { defs, gradFor } = useChartGradients()
  if (data.every((p) => p.spend === 0)) return null
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold">
          <TrendingUp className="h-4 w-4 text-muted-foreground" />
          Spend trend: last 6 months
        </h3>
        <div className="h-60">
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
        </div>
      </CardContent>
    </Card>
  )
}
