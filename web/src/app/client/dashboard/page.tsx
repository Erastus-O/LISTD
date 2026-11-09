import { requireSession } from '@/lib/dal'
import { loadClientDashboardCards } from '@/lib/dashboard/client-stats'
import { loadClientDashboardStats } from '@/lib/dashboard/client-dashboard-stats'
import {
  loadCallerMembership,
  loadWorkerLeaderboard,
  loadWorkerVolume,
  type WorkerLeaderboardRow,
  type WorkerVolumePoint,
} from '@/lib/dashboard/client-workers'
import {
  PendingActionsCard,
  ReportFoldersCard,
  UpcomingInspectionsCard,
} from '@/components/dashboard/client-cards'
import { DeferredBalanceCard } from '@/components/billing/deferred-balance-card'
import { ClientDashboardCharts } from './_components/client-dashboard-charts'
import { ClientKpiGrid } from './_components/kpi-grid'
import { WorkerLeaderboardCard } from './_components/worker-leaderboard-card'
import { WorkerVolumeCard } from './_components/worker-volume-card'

export const metadata = { title: 'Client Dashboard' }

/**
 * Client (owner) dashboard. Surfaces the three attention cards plus a
 * worker-activity chart for org owners (hidden for solo clients).
 *
 * Workers are bounced to `/worker/dashboard` by post-signin dispatch
 * before they ever reach this page.
 */
export default async function ClientDashboardPage() {
  const session = await requireSession()
  const [cards, stats, membership] = await Promise.all([
    loadClientDashboardCards(session.userId),
    loadClientDashboardStats(session.userId),
    loadCallerMembership(session.userId),
  ])

  const isOwner = membership?.orgRole === 'owner'
  const [workerVolume, workerLeaderboard] = isOwner
    ? await Promise.all([
        loadWorkerVolume(membership.organisationId),
        loadWorkerLeaderboard(membership.organisationId),
      ])
    : [[] as WorkerVolumePoint[], [] as WorkerLeaderboardRow[]]

  return (
    <div className="w-full space-y-6 px-6 py-10">
      <div>
        <h1 className="font-display text-3xl text-foreground">
          Welcome back{session.profile?.fullName ? `, ${session.profile.fullName.split(' ')[0]}` : ''}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Here&rsquo;s what&rsquo;s happening across your properties today.
        </p>
      </div>

      <ClientKpiGrid kpi={stats.kpi} />

      <DeferredBalanceCard clientUserId={session.userId} />

      <div className="grid gap-4 lg:grid-cols-2">
        <PendingActionsCard
          items={cards.pendingActions}
          total={cards.pendingActionsTotal}
        />
        <UpcomingInspectionsCard items={cards.upcoming} />
      </div>

      <ClientDashboardCharts
        spend={stats.chart.spend}
        jobsByType={stats.chart.jobsByType}
        jobsByStatus={stats.chart.jobsByStatus}
        byWorker={stats.chart.byWorker}
      />

      <WorkerVolumeCard data={workerVolume} />
      <WorkerLeaderboardCard rows={workerLeaderboard} />

      <ReportFoldersCard
        items={cards.reportFolders}
        total={cards.reportFoldersTotal}
      />
    </div>
  )
}
