import Link from 'next/link'
import {
  AlertCircle,
  AlertTriangle,
  Briefcase,
  ClipboardCheck,
  Clock,
  CreditCard,
  FileText,
  HardHat,
  PoundSterling,
  ShieldCheck,
  Users,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { requireRole } from '@/lib/dal'
import {
  loadAdminDashboard,
  type AdminDashboardAlert,
  type AdminDashboardKpi,
} from '@/lib/dashboard/admin-dashboard'
import { loadBillingProviderId } from '@/lib/billing/select'
import type { BillingProviderId } from '@/lib/billing/provider'
import { AdminDashboardCharts } from './_components/admin-dashboard-charts'

export const metadata = { title: 'Admin · Dashboard' }
export const dynamic = 'force-dynamic'

/**
 * Admin Dashboard (port of Lovable's `src/pages/admin/AdminDashboard.tsx`).
 * Server-renders 8 KPIs + the alerts panel + a static SVG acceptance ring;
 * a single client island handles the 5 recharts charts.
 *
 * Contrast with Lovable, which fired ~12 separate `supabase.from(...)` calls
 * from the client and reactively updated the page. Here all queries run in
 * one `loadAdminDashboard()` transaction → datasets ship pre-baked → charts
 * mount once with no client-side data fetching.
 *
 * `dynamic = 'force-dynamic'` keeps the freshness contract: each admin visit
 * sees current numbers (no 60s ISR cache).
 */
export default async function AdminDashboardPage() {
  await requireRole('admin')
  const [data, providerId] = await Promise.all([
    loadAdminDashboard(),
    loadBillingProviderId(),
  ])
  const { kpi, chart, alerts } = data

  return (
    <div className="w-full space-y-6 px-6 py-10">
      <div>
        <h1 className="font-display text-3xl text-foreground">Admin Dashboard</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          Snapshot · {formatTime(data.generatedAt)}
        </p>
      </div>

      <KPIGrid kpi={kpi} providerId={providerId} />

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <AdminDashboardCharts
          jobsByDay={chart.jobsByDay}
          jobsByType={chart.jobsByType}
          revenueByDay={chart.revenueByDay}
          topClients={chart.topClients}
          topClientsByRevenue={chart.topClientsByRevenue}
          topClerks={chart.topClerks}
        />
        <AcceptanceRing percent={chart.acceptanceRate} />
      </div>

      <AlertsCard alerts={alerts} />
    </div>
  )
}

function KPIGrid({
  kpi,
  providerId,
}: {
  kpi: AdminDashboardKpi
  providerId: BillingProviderId
}) {
  const pendingHours = kpi.pendingOldestHours
  const providerLabel = providerId === 'xero' ? 'via Xero' : 'via inbuilt'
  const outstandingSubtitle =
    kpi.outstandingInvoiceCount === 0
      ? 'no outstanding'
      : `${kpi.outstandingInvoiceCount} ${kpi.outstandingInvoiceCount === 1 ? 'invoice' : 'invoices'} · ${providerLabel}`
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      <KPICard
        icon={<Briefcase className="h-4 w-4" />}
        label="Jobs today"
        value={kpi.jobsToday}
      />
      <KPICard
        icon={<Clock className="h-4 w-4" />}
        label="Pending acceptance"
        value={kpi.pendingAcceptance}
        alert={kpi.pendingAcceptance > 5 && pendingHours !== null && pendingHours > 6}
        alertText={
          pendingHours !== null && pendingHours > 6
            ? `Oldest: ${pendingHours}h ago`
            : undefined
        }
      />
      <KPICard
        icon={<ShieldCheck className="h-4 w-4" />}
        label="Quality review queue"
        value={kpi.qualityQueue}
        alert={kpi.qualityQueue > 3}
      />
      <KPICard
        icon={<Users className="h-4 w-4" />}
        label="Active clients"
        value={kpi.activeClients}
        subtitle="this month"
      />
      <KPICard
        icon={<HardHat className="h-4 w-4" />}
        label="Active clerks"
        value={kpi.activeClerks}
        subtitle="last 30 days"
      />
      <KPICard
        icon={<PoundSterling className="h-4 w-4" />}
        label="Revenue this month"
        value={`£${kpi.revenueMonth.toFixed(0)}`}
      />
      <KPICard
        icon={<FileText className="h-4 w-4" />}
        label="Outstanding invoices"
        value={`£${kpi.outstandingInvoices.toFixed(0)}`}
        subtitle={outstandingSubtitle}
        muted={kpi.outstandingInvoiceCount === 0}
      />
      <KPICard
        icon={<CreditCard className="h-4 w-4" />}
        label="Clerk payouts pending"
        value={`£${kpi.clerkPayoutsPending.toFixed(0)}`}
      />
      <KPICard
        icon={<ClipboardCheck className="h-4 w-4" />}
        label="Cleans awaiting sign-off"
        value={kpi.cleansAwaitingSignoff}
        alert={kpi.cleansAwaitingSignoff > 0}
        alertText={
          kpi.cleansAwaitingSignoff > 0 ? 'Approve to pay cleaners' : undefined
        }
      />
    </div>
  )
}

function KPICard({
  icon,
  label,
  value,
  subtitle,
  alert,
  alertText,
  muted,
}: {
  icon: React.ReactNode
  label: string
  value: string | number
  subtitle?: string
  alert?: boolean
  alertText?: string
  muted?: boolean
}) {
  return (
    <Card className={alert ? 'border-warning/50' : ''}>
      <CardContent className="space-y-1.5 p-4">
        <div className="flex items-center gap-2">
          <span className="text-primary">{icon}</span>
          <span className="text-xs text-muted-foreground">{label}</span>
          {alert && (
            <Badge variant="outline" className="ml-auto px-1 py-0 text-[10px]">
              Alert
            </Badge>
          )}
        </div>
        <p
          className={`text-lg font-bold ${
            muted ? 'text-muted-foreground' : 'text-foreground'
          }`}
        >
          {value}
        </p>
        {(subtitle || alertText) && (
          <p
            className={`text-xs ${
              alert ? 'text-amber-600' : 'text-muted-foreground'
            }`}
          >
            {alertText ?? subtitle}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

function AcceptanceRing({ percent }: { percent: number }) {
  const dash = `${percent * 2.51} 251`
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <h3 className="text-sm font-semibold">Pro acceptance ≤6h</h3>
        <div className="flex h-52 flex-col items-center justify-center">
          <div className="relative h-32 w-32">
            <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
              <circle
                cx="50"
                cy="50"
                r="40"
                fill="none"
                stroke="var(--surface-sunken)"
                strokeWidth="10"
              />
              <circle
                cx="50"
                cy="50"
                r="40"
                fill="none"
                stroke="var(--brand)"
                strokeWidth="10"
                strokeDasharray={dash}
                strokeLinecap="round"
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-2xl font-bold text-foreground">
                {percent}%
              </span>
            </div>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            of jobs accepted within 6h
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

function AlertsCard({ alerts }: { alerts: AdminDashboardAlert[] }) {
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          Active alerts
        </h3>
        {alerts.length === 0 ? (
          <div className="py-6 text-center">
            <ShieldCheck className="mx-auto mb-2 h-8 w-8 text-emerald-600/60" />
            <p className="text-sm text-muted-foreground">
              No active alerts: all clear
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {alerts.map((a, i) => {
              const tone =
                a.severity === 'error'
                  ? 'bg-destructive/10 text-destructive'
                  : 'bg-amber-100/60 text-amber-900'
              const inner = (
                <>
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{a.message}</span>
                </>
              )
              return a.link ? (
                <Link
                  key={i}
                  href={a.link}
                  className={`flex items-start gap-2 rounded-md p-2.5 text-sm transition hover:brightness-95 ${tone}`}
                >
                  {inner}
                </Link>
              ) : (
                <div
                  key={i}
                  className={`flex items-start gap-2 rounded-md p-2.5 text-sm ${tone}`}
                >
                  {inner}
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
