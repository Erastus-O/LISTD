import Link from 'next/link'
import {
  AlertCircle,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  FileText,
  FolderOpen,
  ScrollText,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import type {
  PendingActionItem,
  ReportFolderEntry,
  UpcomingInspection,
} from '@/lib/dashboard/client-stats'

const REASON_META: Record<
  PendingActionItem['reason'],
  { icon: React.ComponentType<{ className?: string }>; tone: string }
> = {
  draft: { icon: ScrollText, tone: 'text-warning' },
  awaiting_signoff: { icon: CheckCircle2, tone: 'text-success' },
  awaiting_ack: { icon: FileText, tone: 'text-primary' },
  pre_inspection_ack: { icon: AlertCircle, tone: 'text-destructive' },
}

/**
 * Where a pending action takes the client. Each reason has a real surface to
 * act on — none point at the (non-existent) generic job detail page.
 *   - pre_inspection_ack → confirm tenant details & access
 *   - awaiting_signoff   → reports (review + sign off)
 *   - draft              → jobs list (where the "Awaiting payment" card lives)
 */
export function pendingActionHref(item: {
  reason: PendingActionItem['reason']
  jobId: string
}): string {
  switch (item.reason) {
    case 'pre_inspection_ack':
      return `/client/jobs/${item.jobId}/confirm`
    case 'awaiting_signoff':
    case 'awaiting_ack':
      return `/client/reports/${item.jobId}`
    case 'draft':
    default:
      return '/client/jobs'
  }
}

/**
 * "Pending Actions" — surfaces the top 5 jobs needing client attention,
 * with the total count in the header. Empty state celebrates inbox-zero.
 */
export function PendingActionsCard({
  items,
  total,
}: {
  items: PendingActionItem[]
  total: number
}) {
  return (
    <Card>
      <CardContent className="p-6">
        <Header
          icon={<ClipboardList className="h-4 w-4" />}
          title="Pending actions"
          count={total}
          countTone={total > 0 ? 'destructive' : 'muted'}
          ctaHref="/client/actions"
          ctaLabel="View all"
        />
        {items.length === 0 ? (
          <EmptyState
            icon={<CheckCircle2 className="h-6 w-6 text-success" />}
            title="You're all caught up."
            body="No drafts, sign-offs, or acknowledgements waiting on you."
          />
        ) : (
          <ul className="divide-y divide-border">
            {items.map((it) => {
              const meta = REASON_META[it.reason]
              const Icon = meta.icon
              return (
                <li key={it.jobId}>
                  <Link
                    href={pendingActionHref(it)}
                    className="flex items-center gap-3 py-3 text-sm transition-colors hover:bg-muted/30 -mx-6 px-6"
                  >
                    <Icon className={`h-4 w-4 shrink-0 ${meta.tone}`} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-foreground">
                        {it.label}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {it.address ?? 'No property linked'}
                        {it.scheduledDate && ` · ${formatDate(it.scheduledDate)}`}
                      </p>
                    </div>
                    <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

/**
 * "Upcoming inspections" — next 7 days, max 5 entries.
 */
export function UpcomingInspectionsCard({
  items,
}: {
  items: UpcomingInspection[]
}) {
  return (
    <Card>
      <CardContent className="p-6">
        <Header
          icon={<CalendarDays className="h-4 w-4" />}
          title="Upcoming inspections"
          subtitle="Next 7 days"
          ctaHref="/client/jobs"
          ctaLabel="View all"
        />
        {items.length === 0 ? (
          <EmptyState
            icon={<CalendarDays className="h-6 w-6 text-muted-foreground" />}
            title="Nothing this week."
            body={
              <>
                Need an inspection?{' '}
                <Link href="/book" className="text-primary hover:underline">
                  Book one →
                </Link>
              </>
            }
          />
        ) : (
          <ul className="divide-y divide-border">
            {items.map((it) => (
              <li key={it.jobId}>
                <Link
                  href={`/client/jobs/${it.jobId}`}
                  className="flex items-center gap-3 py-3 text-sm transition-colors hover:bg-muted/30 -mx-6 px-6"
                >
                  <DateBlock dateISO={it.scheduledDate} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-foreground">
                      {it.address ?? 'No property linked'}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {prettyInspection(it.inspectionType)}
                      {it.clerkName ? ` · ${it.clerkName}` : ' · Awaiting clerk'}
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

/**
 * "Report folders" — quick access to recent property folders. Full folder
 * tree at `/client/reports` lands as part of M1 #13.
 */
export function ReportFoldersCard({
  items,
  total,
}: {
  items: ReportFolderEntry[]
  total: number
}) {
  return (
    <Card>
      <CardContent className="p-6">
        <Header
          icon={<FolderOpen className="h-4 w-4" />}
          title="Report folders"
          count={total}
          countTone="muted"
          ctaHref="/client/reports"
          ctaLabel="Browse all"
        />
        {items.length === 0 ? (
          <EmptyState
            icon={<FileText className="h-6 w-6 text-muted-foreground" />}
            title="No reports yet."
            body="Your delivered reports will be grouped here by property."
          />
        ) : (
          <ul className="divide-y divide-border">
            {items.map((it) => (
              <li key={it.propertyId}>
                <Link
                  href={`/client/reports?property=${it.propertyId}`}
                  className="flex items-center gap-3 py-3 text-sm transition-colors hover:bg-muted/30 -mx-6 px-6"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <FolderOpen className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-foreground">
                      {it.address ?? '(unknown property)'}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {it.reportCount} report{it.reportCount === 1 ? '' : 's'}
                      {it.lastDeliveredAt &&
                        ` · last ${formatDate(it.lastDeliveredAt)}`}
                    </p>
                  </div>
                  <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

// ── small shared bits ──────────────────────────────────────────────────────

function Header({
  icon,
  title,
  subtitle,
  count,
  countTone,
  ctaHref,
  ctaLabel,
}: {
  icon: React.ReactNode
  title: string
  subtitle?: string
  count?: number
  countTone?: 'destructive' | 'muted'
  ctaHref?: string
  ctaLabel?: string
}) {
  return (
    <div className="mb-4 flex items-center justify-between gap-4">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">{icon}</span>
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {typeof count === 'number' && (
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
              countTone === 'destructive'
                ? 'bg-destructive/10 text-destructive'
                : 'bg-muted text-muted-foreground'
            }`}
          >
            {count}
          </span>
        )}
        {subtitle && (
          <span className="text-xs text-muted-foreground">{subtitle}</span>
        )}
      </div>
      {ctaHref && (
        <Link
          href={ctaHref}
          className="text-xs font-medium text-primary hover:underline"
        >
          {ctaLabel ?? 'View'}
        </Link>
      )}
    </div>
  )
}

function EmptyState({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode
  title: string
  body: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center gap-2 py-8 text-center">
      {icon}
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="text-xs text-muted-foreground">{body}</p>
    </div>
  )
}

function DateBlock({ dateISO }: { dateISO: string }) {
  const d = new Date(dateISO)
  const day = d.toLocaleDateString('en-GB', { day: 'numeric' })
  const mon = d.toLocaleDateString('en-GB', { month: 'short' })
  return (
    <div className="flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-lg bg-primary/10 text-primary">
      <span className="text-[10px] font-medium uppercase leading-none">
        {mon}
      </span>
      <span className="text-sm font-bold leading-none">{day}</span>
    </div>
  )
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: '2-digit',
  })
}

function prettyInspection(t: string): string {
  switch (t) {
    case 'new_inventory':
      return 'New Inventory'
    case 'check_in':
      return 'Check-In'
    case 'check_out':
      return 'Check-Out'
    case 'mid_term':
      return 'Mid-Term'
    case 'interim':
      return 'Interim'
    default:
      return t
  }
}
