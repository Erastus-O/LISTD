import Link from 'next/link'
import {
  AlertCircle,
  ArrowRight,
  ArrowRight as ArrowRightIcon,
  Briefcase,
  CalendarCheck,
  ClipboardList,
  Clock,
  Inbox,
  PoundSterling,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ClerkPerformanceCard } from '@/components/clerk/performance-card'
import { requireSession } from '@/lib/dal'
import { loadClerkDashboard } from '@/lib/dashboard/clerk-dashboard'
import { loadWorkerMonthEndDue } from '@/lib/billing/promo-debt'
import { MonthEndPayCard } from '@/components/billing/month-end-pay-card'
import { ClerkDashboardCharts } from './_components/clerk-dashboard-charts'

export const metadata = { title: 'Pro Dashboard' }
export const dynamic = 'force-dynamic'

const PENDING_COPY: Record<
  string,
  { title: string; body: string; cta: string | null }
> = {
  pending_verification: {
    title: 'Application under review',
    body: "We're reviewing your verification documents. This usually takes under 24 hours.",
    cta: null,
  },
  rejected: {
    title: 'Action needed on your application',
    body: 'We need a few changes before we can verify you. Open the application to see the details.',
    cta: '/onboarding/clerk',
  },
  suspended: {
    title: 'Marketplace access suspended',
    body: 'A document on file has expired. Re-upload an in-date copy to restore access.',
    cta: '/onboarding/clerk',
  },
  unverified: {
    title: 'Complete Pro verification',
    body: 'Finish the 5-step verification to start seeing jobs in your area.',
    cta: '/onboarding/clerk',
  },
}

/**
 * Clerk dashboard. Layout matches Lovable's `ClerkDashboardContent`:
 *
 *   - Stats row: Total Earnings · This Month · Avg Job Value · Pending Payments
 *   - Charts row: Earnings overview (bar) + Inspection types (pie)
 *   - Action cards: Available Jobs · Today's Inspections · Submitted Reports
 *   - Performance card (existing M1 #10 component) shown alongside
 *
 * The pending-verification banner stays at the top — clerks who haven't
 * been verified yet get a redirect-to-onboarding CTA. Unverified clerks
 * still see the dashboard shell with empty stats so they understand what
 * the screen will look like once they're approved.
 */
export default async function ClerkDashboardPage() {
  const session = await requireSession()
  const status = session.profile?.verificationStatus ?? 'unverified'
  const pending = status !== 'verified' ? PENDING_COPY[status] : null
  const [stats, monthEndDue] = await Promise.all([
    loadClerkDashboard(session.userId),
    loadWorkerMonthEndDue(session.userId),
  ])

  return (
    <div className="w-full space-y-6 px-6 py-10">
      {pending && (
        <Card>
          <CardContent className="flex items-start gap-4 p-5">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
            <div className="flex-1">
              <p className="text-sm font-medium text-foreground">
                {pending.title}
              </p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {pending.body}
              </p>
            </div>
            {pending.cta && (
              <Link
                href={pending.cta}
                className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
              >
                Continue
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            )}
          </CardContent>
        </Card>
      )}

      {/* Stats row */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Total Earnings"
          value={`£${stats.totalEarnings.toFixed(0)}`}
          sub="All time (after fees)"
          icon={PoundSterling}
          tone="success"
        />
        <StatCard
          label="This Month"
          value={`£${stats.monthEarnings.toFixed(0)}`}
          sub={`${stats.monthJobs} jobs completed`}
          icon={TrendingUp}
          tone="accent"
        />
        <StatCard
          label="Avg Job Value"
          value={`£${stats.avgJobValue.toFixed(0)}`}
          sub="Per inspection"
          icon={Briefcase}
          tone="primary"
        />
        <StatCard
          label="Pending Payments"
          value={String(stats.pendingPayments)}
          sub="Awaiting release"
          icon={Clock}
          tone="warn"
        />
      </div>

      <MonthEndPayCard due={monthEndDue} />

      {/* Charts */}
      <ClerkDashboardCharts
        monthlyData={stats.monthlyData}
        inspectionTypeBreakdown={stats.inspectionTypeBreakdown}
      />

      {/* Action cards + performance */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <ActionCard
          icon={Inbox}
          tone="accent"
          title="Available Jobs"
          subtitle="New inspections waiting for you"
          badge={stats.availableJobs > 0 ? stats.availableJobs : null}
          ctaLabel="View Available"
          href="/clerk/jobs/available"
        />
        <ActionCard
          icon={CalendarCheck}
          tone="warn"
          title="Today's Inspections"
          subtitle="Jobs scheduled for today"
          badge={stats.todayInspections > 0 ? stats.todayInspections : null}
          ctaLabel="Start Inspection"
          href="/clerk/jobs"
        />
        <ActionCard
          icon={ClipboardList}
          tone="success"
          title="Submitted Reports"
          subtitle="Awaiting client review"
          badge={stats.submittedReports > 0 ? stats.submittedReports : null}
          ctaLabel="View Reports"
          href="/clerk/reports"
        />
        <ClerkPerformanceCard
          jobsCompleted={session.profile?.clerkJobsCompleted ?? 0}
          rating={Number(session.profile?.clerkRating ?? 0)}
          level={session.profile?.clerkLevel ?? 1}
        />
      </div>
    </div>
  )
}

const TONE_CLASSES: Record<
  'success' | 'accent' | 'primary' | 'warn',
  string
> = {
  success: 'bg-emerald-500/10 text-emerald-600',
  accent: 'bg-amber-300/15 text-amber-600',
  primary: 'bg-primary/10 text-primary',
  warn: 'bg-amber-500/10 text-amber-700',
}

function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  tone,
}: {
  label: string
  value: string
  sub: string
  icon: LucideIcon
  tone: keyof typeof TONE_CLASSES
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="mb-2 flex items-start justify-between">
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        <span
          className={`flex h-8 w-8 items-center justify-center rounded-lg ${TONE_CLASSES[tone]}`}
        >
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <p className="text-xl font-bold text-foreground">{value}</p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{sub}</p>
    </div>
  )
}

function ActionCard({
  icon: Icon,
  tone,
  title,
  subtitle,
  badge,
  ctaLabel,
  href,
}: {
  icon: LucideIcon
  tone: keyof typeof TONE_CLASSES
  title: string
  subtitle: string
  badge: number | null
  ctaLabel: string
  href: string
}) {
  return (
    <Card className="transition-shadow hover:shadow-md">
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start justify-between">
          <span
            className={`flex h-9 w-9 items-center justify-center rounded-lg ${TONE_CLASSES[tone]}`}
          >
            <Icon className="h-4 w-4" />
          </span>
          {badge !== null && (
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-bold ${TONE_CLASSES[tone]}`}
            >
              {badge}
            </span>
          )}
        </div>
        <div>
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          <p className="text-[11px] text-muted-foreground">{subtitle}</p>
        </div>
        <Button asChild variant="outline" size="sm" className="w-full text-xs">
          <Link href={href} className="group inline-flex items-center gap-1">
            {ctaLabel}
            <ArrowRightIcon className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </Button>
      </CardContent>
    </Card>
  )
}
