'use client'

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Users } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import {
  CHART_AXIS,
  CHART_GRID,
  ChartTooltip,
  useChartGradients,
} from '@/components/charts/chart-theme'
import type { WorkerVolumePoint } from '@/lib/dashboard/client-workers'

type Props = { data: WorkerVolumePoint[] }

/**
 * Worker-volume horizontal bar — jobs posted per worker in the last 30
 * days. Hidden when there are no rows so solo clients see no card.
 */
export function WorkerVolumeCard({ data }: Props) {
  const { defs, gradFor } = useChartGradients()
  if (data.length === 0) return null
  const chartData = data.map((d) => ({
    name: d.fullName ?? '(unnamed)',
    jobs: d.jobsPosted,
  }))
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold">
          <Users className="h-4 w-4 text-muted-foreground" />
          Worker activity: last 30 days
        </h3>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} layout="vertical" barCategoryGap="28%">
              {defs}
              <CartesianGrid {...CHART_GRID} horizontal={false} vertical />
              <XAxis type="number" allowDecimals={false} {...CHART_AXIS} />
              <YAxis
                type="category"
                dataKey="name"
                width={150}
                {...CHART_AXIS}
              />
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
              <Bar
                dataKey="jobs"
                fill={gradFor(0, 'bar')}
                radius={[0, 6, 6, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}
