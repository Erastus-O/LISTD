import Link from 'next/link'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { requireRole } from '@/lib/dal'
import {
  loadActivityLog,
  parseActivityLogFilter,
} from '@/lib/dashboard/activity-log'
import { ActivityFilterBar } from './activity-filter-bar'

export const metadata = { title: 'Admin · Activity log' }
export const dynamic = 'force-dynamic'

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

const CATEGORY_TONE: Record<
  string,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  job_lifecycle: 'secondary',
  verification: 'default',
  impersonation: 'destructive',
  pricing_override: 'outline',
  strike: 'destructive',
  platform_setting: 'outline',
  tenant_portal_access: 'secondary',
  account_status: 'destructive',
  dispute: 'destructive',
  billing: 'default',
}

/**
 * Admin Activity log — a global, paginated, filterable view of every
 * `audit_events` row: who did what, to what, when, and from which IP. URL-driven
 * filters (free text + category + date range). Admin-gated.
 */
export default async function AdminActivityPage({ searchParams }: Props) {
  await requireRole('admin')
  const sp = await searchParams
  const filter = parseActivityLogFilter(sp)
  const { rows, total, page, pageCount } = await loadActivityLog(filter)

  const pageHref = (p: number) => {
    const qs = new URLSearchParams()
    if (filter.q) qs.set('q', filter.q)
    if (filter.category) qs.set('category', filter.category)
    if (filter.from) qs.set('from', filter.from)
    if (filter.to) qs.set('to', filter.to)
    if (p > 1) qs.set('page', String(p))
    const s = qs.toString()
    return s ? `/admin/activity?${s}` : '/admin/activity'
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-6 py-10">
      <div>
        <h1 className="font-display text-3xl text-foreground">Activity log</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {total.toLocaleString()} {total === 1 ? 'event' : 'events'} · page{' '}
          {page} of {pageCount}
        </p>
      </div>

      <ActivityFilterBar />

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/30 text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 text-left font-medium">When</th>
                  <th className="px-4 py-2.5 text-left font-medium">User</th>
                  <th className="px-4 py-2.5 text-left font-medium">Category</th>
                  <th className="px-4 py-2.5 text-left font-medium">Action</th>
                  <th className="px-4 py-2.5 text-left font-medium">Target</th>
                  <th className="px-4 py-2.5 text-left font-medium">IP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-4 py-12 text-center text-sm text-muted-foreground"
                    >
                      No activity matches these filters.
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => (
                    <tr key={r.id} className="align-top hover:bg-muted/20">
                      <td className="whitespace-nowrap px-4 py-2.5 text-xs text-muted-foreground">
                        {formatDateTime(r.createdAt)}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="text-foreground">
                          {r.actorName ?? (r.actorUserId ? 'Unknown user' : 'System')}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge
                          variant={CATEGORY_TONE[r.category] ?? 'outline'}
                          className="text-[10px]"
                        >
                          {r.category.replace(/_/g, ' ')}
                        </Badge>
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs text-foreground">
                        {r.action}
                      </td>
                      <td className="px-4 py-2.5 text-xs">
                        {r.targetType ? (
                          <span className="text-muted-foreground">
                            {r.targetType}
                            {r.targetId ? (
                              <span className="ml-1 font-mono text-foreground">
                                {r.targetId.length > 12
                                  ? r.targetId.slice(0, 8) + '…'
                                  : r.targetId}
                              </span>
                            ) : null}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 font-mono text-[11px] text-muted-foreground">
                        {r.ipAddress ?? '—'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {pageCount > 1 && (
        <div className="flex items-center justify-between">
          <PagerLink
            href={pageHref(page - 1)}
            disabled={page <= 1}
            dir="prev"
          />
          <span className="text-xs text-muted-foreground">
            Page {page} of {pageCount}
          </span>
          <PagerLink
            href={pageHref(page + 1)}
            disabled={page >= pageCount}
            dir="next"
          />
        </div>
      )}
    </div>
  )
}

function PagerLink({
  href,
  disabled,
  dir,
}: {
  href: string
  disabled: boolean
  dir: 'prev' | 'next'
}) {
  const cls =
    'inline-flex h-9 items-center gap-1.5 rounded-md border border-border px-3 text-sm'
  if (disabled) {
    return (
      <span className={`${cls} cursor-not-allowed text-muted-foreground/50`}>
        {dir === 'prev' ? (
          <>
            <ChevronLeft className="h-4 w-4" /> Prev
          </>
        ) : (
          <>
            Next <ChevronRight className="h-4 w-4" />
          </>
        )}
      </span>
    )
  }
  return (
    <Link href={href} className={`${cls} transition-colors hover:bg-muted`}>
      {dir === 'prev' ? (
        <>
          <ChevronLeft className="h-4 w-4" /> Prev
        </>
      ) : (
        <>
          Next <ChevronRight className="h-4 w-4" />
        </>
      )}
    </Link>
  )
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}
