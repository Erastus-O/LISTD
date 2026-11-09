import Link from 'next/link'
import { Trophy } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { ProfileAvatar } from '@/components/role/profile-avatar'
import type { WorkerLeaderboardRow } from '@/lib/dashboard/client-workers'

type Props = { rows: WorkerLeaderboardRow[] }

/**
 * Top-N worker leaderboard (last 90 days). Surfaces standouts vs.
 * underperformers across three columns: jobs posted, spend driven,
 * completion rate. Rows link out to the per-worker drill-down page.
 *
 * Hidden when there are no rows (the org has no workers who posted in
 * the window).
 */
export function WorkerLeaderboardCard({ rows }: Props) {
  if (rows.length === 0) return null
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold">
          <Trophy className="h-4 w-4 text-muted-foreground" />
          Worker leaderboard: last 90 days
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Worker</th>
                <th className="px-3 py-2 text-right font-medium">Jobs</th>
                <th className="px-3 py-2 text-right font-medium">Spend</th>
                <th className="px-3 py-2 text-right font-medium">
                  Completion
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => (
                <tr key={r.userId} className="hover:bg-muted/30">
                  <td className="px-3 py-2">
                    <Link
                      href={`/client/team/${r.userId}`}
                      className="flex items-center gap-2 hover:underline"
                    >
                      <ProfileAvatar
                        url={r.avatarUrl}
                        name={r.fullName}
                        size="sm"
                      />
                      <span className="font-medium text-foreground">
                        {r.fullName ?? '(no name)'}
                      </span>
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-right text-xs">
                    {r.jobsPosted}
                  </td>
                  <td className="px-3 py-2 text-right text-xs">
                    £{r.spend.toFixed(0)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <CompletionPill percent={r.completionRatePercent} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}

function CompletionPill({ percent }: { percent: number | null }) {
  if (percent === null) {
    return <span className="text-xs text-muted-foreground">—</span>
  }
  const tone =
    percent >= 80
      ? 'bg-emerald-500/15 text-emerald-700'
      : percent >= 50
        ? 'bg-amber-500/15 text-amber-700'
        : 'bg-muted text-muted-foreground'
  return (
    <span
      className={`inline-flex h-5 items-center rounded-full px-2 text-[11px] font-medium ${tone}`}
    >
      {percent}%
    </span>
  )
}
