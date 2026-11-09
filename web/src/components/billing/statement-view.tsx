import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import type { ClientStatement } from '@/lib/billing/statement'

type Props = {
  statement: ClientStatement
  /** Where each row's reference links. e.g. `/admin/invoices` or `/client/invoices`. */
  invoiceBase: string
}

const STATUS_TONE: Record<
  string,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  issued: 'default',
  sent: 'default',
  paid: 'secondary',
  overdue: 'destructive',
}

/**
 * Statement of account renderer. Used by both the admin and client
 * statement pages. Stateless — caller passes a fully-loaded
 * `ClientStatement` plus the base URL each invoice link should target.
 */
export function StatementView({ statement, invoiceBase }: Props) {
  const fmt = new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: statement.currency,
  })
  const recipient =
    statement.client.companyName ?? statement.client.fullName ?? '(no name)'

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl text-foreground">
          Statement of account
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {recipient} · As of {statement.asOf}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <AgeingTile label="Current" value={statement.ageing.current} fmt={fmt} />
        <AgeingTile
          label="1 – 30 days"
          value={statement.ageing.days30}
          fmt={fmt}
        />
        <AgeingTile
          label="31 – 60 days"
          value={statement.ageing.days60}
          fmt={fmt}
        />
        <AgeingTile
          label="61 – 90 days"
          value={statement.ageing.days90}
          fmt={fmt}
        />
        <AgeingTile
          label="90+ days"
          value={statement.ageing.days90plus}
          fmt={fmt}
          tone="danger"
        />
      </div>

      <Card>
        <CardContent className="space-y-3 p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">Total spent to date</h2>
            <span className="font-mono text-xl text-foreground">
              {fmt.format(statement.totalPaid)}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            Everything paid so far: settled invoices plus jobs paid at booking
            {statement.prepaidTotal > 0
              ? ` (of which ${fmt.format(statement.prepaidTotal)} is awaiting its receipt below)`
              : ''}
            . This tracks the spend figures on your dashboard.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">Net outstanding</h2>
            <span
              className={`font-mono text-xl ${
                statement.netOutstanding < 0
                  ? 'text-emerald-600'
                  : statement.netOutstanding > 0
                    ? 'text-destructive'
                    : 'text-foreground'
              }`}
            >
              {fmt.format(statement.netOutstanding)}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            {statement.netOutstanding > 0
              ? 'Amount owed to LISTD Pro.'
              : statement.netOutstanding < 0
                ? 'Client is in credit : credit notes exceed unpaid invoices.'
                : 'Balance is settled in full.'}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 text-left font-medium">
                    Reference
                  </th>
                  <th className="px-4 py-2.5 text-left font-medium">Issued</th>
                  <th className="px-4 py-2.5 text-left font-medium">Due</th>
                  <th className="px-4 py-2.5 text-left font-medium">Status</th>
                  <th className="px-4 py-2.5 text-right font-medium">Total</th>
                  <th className="px-4 py-2.5 text-right font-medium">Paid</th>
                  <th className="px-4 py-2.5 text-right font-medium">
                    Balance
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {statement.rows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="py-10 text-center text-sm text-muted-foreground"
                    >
                      No invoices or credit notes on file.
                    </td>
                  </tr>
                ) : (
                  statement.rows.map((r) => (
                    <tr key={r.id} className="hover:bg-muted/30">
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-1.5">
                          <Link
                            href={`${invoiceBase}/${r.id}`}
                            className="font-mono text-xs text-primary hover:underline"
                          >
                            {r.reference ?? '—'}
                          </Link>
                          {r.kind === 'credit_note' && (
                            <Badge
                              variant="outline"
                              className="text-[9px] uppercase tracking-wide"
                            >
                              CN
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-xs">
                        {r.issueDate ?? '—'}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-xs">
                        {r.dueDate ?? '—'}
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge variant={STATUS_TONE[r.status] ?? 'outline'}>
                          {r.status}
                        </Badge>
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs">
                        {fmt.format(r.signedTotal)}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs">
                        {r.kind === 'credit_note'
                          ? '—'
                          : fmt.format(Number(r.paidTotal))}
                      </td>
                      <td
                        className={`px-4 py-2.5 text-right font-mono text-xs ${
                          r.signedOutstanding < 0
                            ? 'text-emerald-600'
                            : r.signedOutstanding > 0
                              ? 'text-destructive'
                              : 'text-muted-foreground'
                        }`}
                      >
                        {fmt.format(r.signedOutstanding)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {statement.prepaidRows.length > 0 && (
        <Card>
          <CardContent className="space-y-3 p-6">
            <div>
              <h2 className="text-sm font-semibold">
                Paid at booking: receipt pending
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                These jobs were paid in full when booked. Their receipt invoice
                is issued automatically once the job completes review.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5 text-left font-medium">Job</th>
                    <th className="px-4 py-2.5 text-left font-medium">Service</th>
                    <th className="px-4 py-2.5 text-left font-medium">Paid on</th>
                    <th className="px-4 py-2.5 text-right font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {statement.prepaidRows.map((p) => (
                    <tr key={p.jobId} className="hover:bg-muted/30">
                      <td className="px-4 py-2.5 font-mono text-xs">
                        {p.reference}
                      </td>
                      <td className="px-4 py-2.5 text-xs">
                        {prettyService(p.inspectionType)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-xs">
                        {p.paidAt ?? '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs">
                        {fmt.format(p.amount)}
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-muted/20">
                    <td colSpan={3} className="px-4 py-2.5 text-xs font-medium">
                      Prepaid total
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs font-medium">
                      {fmt.format(statement.prepaidTotal)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function prettyService(t: string): string {
  const known: Record<string, string> = {
    new_inventory: 'New Inventory',
    check_in: 'Check-In',
    check_out: 'Check-Out',
    mid_term: 'Mid-Term',
    interim: 'Interim',
    clean_light: 'Light clean',
    clean_general: 'General clean',
    clean_deep: 'Deep clean',
  }
  return (
    known[t] ??
    t.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  )
}

function AgeingTile({
  label,
  value,
  fmt,
  tone,
}: {
  label: string
  value: number
  fmt: Intl.NumberFormat
  tone?: 'danger'
}) {
  return (
    <div
      className={`rounded-md border bg-card p-3 ${
        tone === 'danger' && value > 0
          ? 'border-destructive/50 bg-destructive/5'
          : 'border-border'
      }`}
    >
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p
        className={`mt-1 font-mono text-base ${
          tone === 'danger' && value > 0
            ? 'text-destructive'
            : 'text-foreground'
        }`}
      >
        {fmt.format(value)}
      </p>
    </div>
  )
}
