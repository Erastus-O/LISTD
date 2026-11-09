import { Award, CheckCircle2, Star } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'

type Props = {
  jobsCompleted: number
  rating: number
  level: number
}

/**
 * Compact performance card for the clerk dashboard (M1 #10 / PRD §5.11).
 *
 * Shows the three counters that exist on `profiles` today: jobs completed,
 * rating, and tier level. The full reliability breakdown (no-shows,
 * cancellations, on-time rate) lands when those counter columns are added —
 * tracked separately in M2.
 */
export function ClerkPerformanceCard({
  jobsCompleted,
  rating,
  level,
}: Props) {
  return (
    <Card>
      <CardContent className="p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">Performance</h3>
          <span className="text-xs text-muted-foreground">PRD §5.11</span>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <Stat
            icon={<CheckCircle2 className="h-4 w-4 text-primary" />}
            label="Jobs"
            value={jobsCompleted.toString()}
          />
          <Stat
            icon={<Star className="h-4 w-4 text-primary" />}
            label="Rating"
            value={rating > 0 ? rating.toFixed(1) : '—'}
          />
          <Stat
            icon={<Award className="h-4 w-4 text-primary" />}
            label="Tier"
            value={`L${level}`}
          />
        </div>
        <p className="mt-4 text-[11px] text-muted-foreground">
          Reliability counters (no-shows, cancellations, on-time rate) ship in M2.
        </p>
      </CardContent>
    </Card>
  )
}

function Stat({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode
  label: string
  value: string
}) {
  return (
    <div className="rounded-lg bg-muted/40 p-3">
      <div className="mb-1 flex items-center gap-1 text-xs text-muted-foreground">
        {icon}
        {label}
      </div>
      <p className="text-lg font-semibold text-foreground">{value}</p>
    </div>
  )
}
