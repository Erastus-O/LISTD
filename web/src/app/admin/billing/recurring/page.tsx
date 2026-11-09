import Link from 'next/link'
import { asc, desc, eq } from 'drizzle-orm'
import { Plus, RefreshCw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { db, profiles, recurringInvoiceTemplates } from '@/db'
import { requireRole } from '@/lib/dal'
import { RecurringActions } from './_components/recurring-actions'

export const metadata = { title: 'Admin · Recurring invoices' }
export const dynamic = 'force-dynamic'

const CADENCE_LABEL: Record<string, string> = {
  weekly: 'Weekly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
}

const AUTO_ACTION_LABEL: Record<string, string> = {
  draft: 'Mint draft',
  issued: 'Auto-issue',
  sent: 'Auto-issue & send',
}

/**
 * Admin recurring-invoice templates index. Read-only table of every
 * template plus per-row pause/resume/delete actions. New templates are
 * authored at `/admin/billing/recurring/new` (server-driven form, parallel
 * to /admin/invoices/new).
 */
export default async function AdminRecurringPage() {
  await requireRole('admin')

  const rows = await db
    .select({
      id: recurringInvoiceTemplates.id,
      clientId: recurringInvoiceTemplates.clientId,
      cadence: recurringInvoiceTemplates.cadence,
      dayOfMonth: recurringInvoiceTemplates.dayOfMonth,
      dayOfWeek: recurringInvoiceTemplates.dayOfWeek,
      autoAction: recurringInvoiceTemplates.autoAction,
      active: recurringInvoiceTemplates.active,
      nextRunAt: recurringInvoiceTemplates.nextRunAt,
      endsOn: recurringInvoiceTemplates.endsOn,
      lastRunAt: recurringInvoiceTemplates.lastRunAt,
      createdAt: recurringInvoiceTemplates.createdAt,
      clientFullName: profiles.fullName,
      clientCompany: profiles.companyName,
    })
    .from(recurringInvoiceTemplates)
    .leftJoin(profiles, eq(profiles.userId, recurringInvoiceTemplates.clientId))
    .orderBy(desc(recurringInvoiceTemplates.active), asc(recurringInvoiceTemplates.nextRunAt))

  return (
    <div className="w-full space-y-6 px-6 py-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <RefreshCw className="h-6 w-6 text-muted-foreground" />
          <div>
            <h1 className="font-display text-3xl text-foreground">
              Recurring invoices
            </h1>
            <p className="mt-1 text-xs text-muted-foreground">
              {rows.length} {rows.length === 1 ? 'template' : 'templates'} ·
              Cron mints drafts daily at 07:15 UTC
            </p>
          </div>
        </div>
        <Button asChild size="sm" className="gap-1.5">
          <Link href="/admin/billing/recurring/new">
            <Plus className="h-4 w-4" />
            New template
          </Link>
        </Button>
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No recurring templates yet. Create one to auto-issue invoices
            on a schedule.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5 text-left font-medium">
                      Client
                    </th>
                    <th className="px-4 py-2.5 text-left font-medium">
                      Cadence
                    </th>
                    <th className="px-4 py-2.5 text-left font-medium">
                      On fire
                    </th>
                    <th className="px-4 py-2.5 text-left font-medium">
                      Next run
                    </th>
                    <th className="px-4 py-2.5 text-left font-medium">Ends</th>
                    <th className="px-4 py-2.5 text-left font-medium">
                      Status
                    </th>
                    <th className="px-4 py-2.5 text-right font-medium">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((r) => (
                    <tr key={r.id} className="hover:bg-muted/30">
                      <td className="px-4 py-2.5 text-xs">
                        {r.clientCompany ?? r.clientFullName ?? '—'}
                      </td>
                      <td className="px-4 py-2.5 text-xs">
                        {CADENCE_LABEL[r.cadence] ?? r.cadence}
                        {r.cadence !== 'weekly' && r.dayOfMonth
                          ? ` · day ${r.dayOfMonth}`
                          : ''}
                        {r.cadence === 'weekly' && r.dayOfWeek !== null
                          ? ` · ${weekdayLabel(r.dayOfWeek)}`
                          : ''}
                      </td>
                      <td className="px-4 py-2.5 text-xs">
                        {AUTO_ACTION_LABEL[r.autoAction] ?? r.autoAction}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs">
                        {r.nextRunAt}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-muted-foreground">
                        {r.endsOn ?? '—'}
                      </td>
                      <td className="px-4 py-2.5">
                        {r.active ? (
                          <Badge variant="default">Active</Badge>
                        ) : (
                          <Badge variant="outline">Paused</Badge>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <RecurringActions
                          templateId={r.id}
                          active={r.active}
                        />
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

function weekdayLabel(d: number | null): string {
  if (d === null) return ''
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d] ?? ''
}
