import Link from 'next/link'
import { Download } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { EmailLogsFilterBar } from './email-logs-filter-bar'
import { requireRole } from '@/lib/dal'
import {
  loadEmailLogs,
  parseEmailLogsFilter,
} from '@/lib/dashboard/email-logs'

export const metadata = { title: 'Admin · Email Logs' }

const STATUS_TONE: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  sent: 'secondary',
  failed: 'destructive',
  bounced: 'destructive',
  webhook: 'outline',
}

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

/**
 * Email log dashboard (M2 #12). URL-driven filters, server-rendered table
 * (top 100 most recent), CSV export at [`/api/admin/email-logs/export`](
 * ../../api/admin/email-logs/export/route.ts) honouring the same filters.
 *
 * Status pill values:
 *   - `sent`     — Resend accepted it
 *   - `failed`   — Resend rejected it (or threw before send)
 *   - `bounced`  — written by [`/api/webhooks/resend`](../../api/webhooks/resend/route.ts)
 *                  on `email.bounced` (hard) and `email.complained`
 *   - `webhook`  — informational webhook events (`delivered`/`opened`/...)
 */
export default async function AdminEmailLogsPage({ searchParams }: Props) {
  await requireRole('admin')
  const sp = await searchParams
  const filter = parseEmailLogsFilter(sp)
  const { rows, total, functionNames } = await loadEmailLogs(filter)

  const exportQs = new URLSearchParams()
  for (const [k, v] of Object.entries(filter)) {
    if (v) exportQs.set(k, String(v))
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-6 py-10">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl text-foreground">Email logs</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {total} {total === 1 ? 'event' : 'events'}
            {rows.length < total ? ` · showing the latest ${rows.length}` : ''}
          </p>
        </div>
        <Link
          href={`/api/admin/email-logs/export?${exportQs.toString()}`}
          className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-sm transition-colors hover:bg-muted"
        >
          <Download className="h-3.5 w-3.5" />
          Export CSV
        </Link>
      </div>

      <EmailLogsFilterBar functionNames={functionNames} />

      {rows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No email events match this filter.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5 text-left font-medium">When</th>
                    <th className="px-4 py-2.5 text-left font-medium">Template</th>
                    <th className="px-4 py-2.5 text-left font-medium">Recipient</th>
                    <th className="px-4 py-2.5 text-left font-medium">Subject</th>
                    <th className="px-4 py-2.5 text-left font-medium">Status</th>
                    <th className="px-4 py-2.5 text-left font-medium">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((r) => (
                    <tr key={r.id} className="hover:bg-muted/30">
                      <td className="whitespace-nowrap px-4 py-2.5 text-xs text-muted-foreground">
                        {formatDateTime(r.createdAt)}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="font-mono text-xs">{r.functionName}</span>
                        {r.templateVersion && (
                          <span className="ml-1.5 text-[10px] text-muted-foreground">
                            {r.templateVersion}
                          </span>
                        )}
                      </td>
                      <td className="max-w-[200px] truncate px-4 py-2.5 text-xs">
                        {r.recipientEmail}
                      </td>
                      <td className="max-w-[260px] truncate px-4 py-2.5 text-xs">
                        {r.subject}
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge variant={STATUS_TONE[r.status] ?? 'outline'}>
                          {r.status}
                        </Badge>
                      </td>
                      <td className="max-w-[280px] truncate px-4 py-2.5 text-xs text-muted-foreground">
                        {r.errorMessage ?? r.resendId ?? ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}
