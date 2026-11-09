'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, FileUp, Loader2, X } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type Match = {
  invoiceId: string
  reference: string | null
  clientName: string
  total: number
  outstanding: number
  confidence: 'reference' | 'amount' | 'none'
} | null

type ParsedRow = {
  row: {
    index: number
    date: string | null
    description: string
    amount: number
    reference: string | null
  }
  match: Match
  /** Local state — true when admin has confirmed; false when skipped. */
  confirmed: boolean
  /** Editable amount for the match (defaults to row.amount). */
  amountToRecord: string
  /** Final outcome from the server after submit. */
  status: 'pending' | 'success' | 'failed'
  errorMessage: string | null
}

/**
 * Three-stage reconciliation flow:
 *
 *   1. Upload a CSV → POST /reconcile/parse → render the match table.
 *   2. Admin toggles confirm/skip per row, edits amount if needed.
 *   3. Submit → POST /reconcile/match in one batch; each row's result
 *      decorates the row with a status badge.
 *
 * The matched-invoice column shows the auto-detected candidate; the
 * admin can clear it (treating the row as "no match") but can't pick a
 * different invoice from this UI — that's a follow-up if there's
 * demand. The simpler path is: clear the auto-match and record manually
 * from the invoice detail page.
 */
export function ReconcileForm() {
  const router = useRouter()
  const [parsing, setParsing] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [rows, setRows] = useState<ParsedRow[]>([])

  async function handleFile(file: File) {
    setParsing(true)
    try {
      const text = await file.text()
      const res = await fetch('/api/admin/billing/reconcile/parse', {
        method: 'POST',
        headers: { 'content-type': 'text/csv' },
        body: text,
      })
      const json = (await res.json().catch(() => ({}))) as {
        rows?: Array<{ row: ParsedRow['row']; match: Match }>
        error?: string
      }
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
      const parsed = (json.rows ?? []).map((r): ParsedRow => ({
        row: r.row,
        match: r.match,
        // Default confirm = true only when we have a match.
        confirmed: !!r.match,
        amountToRecord: r.row.amount.toFixed(2),
        status: 'pending',
        errorMessage: null,
      }))
      setRows(parsed)
      if (parsed.length === 0) {
        toast.info('No credit rows found in this file.')
      } else {
        toast.success(
          `${parsed.length} credit ${parsed.length === 1 ? 'row' : 'rows'} parsed`,
          {
            description: `${parsed.filter((r) => r.match).length} auto-matched.`,
          }
        )
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Parse failed')
    } finally {
      setParsing(false)
    }
  }

  function patchRow(index: number, patch: Partial<ParsedRow>) {
    setRows((prev) =>
      prev.map((r) => (r.row.index === index ? { ...r, ...patch } : r))
    )
  }

  async function submit() {
    const toSubmit = rows.filter(
      (r) => r.confirmed && r.match && r.status !== 'success'
    )
    if (toSubmit.length === 0) {
      toast.error('Nothing to record. Confirm at least one matched row.')
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch('/api/admin/billing/reconcile/match', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          matches: toSubmit.map((r) => ({
            invoiceId: r.match!.invoiceId,
            paidAmount: Number.parseFloat(r.amountToRecord),
            paidAt: r.row.date ?? new Date().toISOString().slice(0, 10),
            reference: r.row.reference || r.row.description.slice(0, 200),
            note: 'Reconciled from bank statement',
          })),
        }),
      })
      const json = (await res.json().catch(() => ({}))) as {
        results?: Array<{ invoiceId: string; ok: boolean; error: string | null }>
        successCount?: number
        error?: string
      }
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
      const byInvoice = new Map(
        (json.results ?? []).map((r) => [r.invoiceId, r])
      )
      setRows((prev) =>
        prev.map((r) => {
          if (!r.confirmed || !r.match) return r
          const result = byInvoice.get(r.match.invoiceId)
          if (!result) return r
          return {
            ...r,
            status: result.ok ? 'success' : 'failed',
            errorMessage: result.error,
          }
        })
      )
      toast.success(
        `Recorded ${json.successCount ?? 0} ${
          json.successCount === 1 ? 'payment' : 'payments'
        }`
      )
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Submit failed')
    } finally {
      setSubmitting(false)
    }
  }

  const fmt = new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
  })

  const summary = {
    total: rows.length,
    matched: rows.filter((r) => !!r.match).length,
    confirmed: rows.filter((r) => r.confirmed && r.match).length,
    success: rows.filter((r) => r.status === 'success').length,
  }

  return (
    <div className="space-y-6">
      <div>
        <Label htmlFor="csv" className="text-xs">
          Bank statement CSV
        </Label>
        <div className="mt-1 flex items-center gap-2">
          <Input
            id="csv"
            type="file"
            accept=".csv,text/csv,text/plain"
            disabled={parsing}
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void handleFile(f)
            }}
            className="text-sm"
          />
          {parsing && (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          )}
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Supports common UK bank export formats (Lloyds, HSBC, Barclays).
          Only credit rows (money in) are reconciled.
        </p>
      </div>

      {rows.length > 0 && (
        <>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {summary.total} rows · {summary.matched} matched ·{' '}
              {summary.confirmed} confirmed · {summary.success} recorded
            </span>
            <FileUp className="h-3.5 w-3.5" />
          </div>

          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Date</th>
                  <th className="px-3 py-2 text-left font-medium">
                    Description
                  </th>
                  <th className="px-3 py-2 text-right font-medium">Amount</th>
                  <th className="px-3 py-2 text-left font-medium">Match</th>
                  <th className="px-3 py-2 text-right font-medium">Record</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r) => (
                  <tr
                    key={r.row.index}
                    className={
                      r.status === 'success'
                        ? 'bg-emerald-50/40'
                        : r.status === 'failed'
                          ? 'bg-destructive/5'
                          : ''
                    }
                  >
                    <td className="px-3 py-2 font-mono text-xs">
                      {r.row.date ?? '—'}
                    </td>
                    <td className="max-w-[280px] truncate px-3 py-2 text-xs">
                      {r.row.description}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-xs">
                      {fmt.format(r.row.amount)}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {r.match ? (
                        <div>
                          <p className="font-mono text-foreground">
                            {r.match.reference ?? '—'}
                          </p>
                          <p className="text-[11px] text-muted-foreground">
                            {r.match.clientName} · owe{' '}
                            {fmt.format(r.match.outstanding)}
                          </p>
                          <Badge
                            variant={
                              r.match.confidence === 'reference'
                                ? 'default'
                                : 'outline'
                            }
                            className="mt-1 text-[9px] uppercase tracking-wide"
                          >
                            {r.match.confidence === 'reference'
                              ? 'Ref match'
                              : 'Amount match'}
                          </Badge>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">No match</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {r.status === 'success' ? (
                        <span className="inline-flex items-center gap-1 text-xs text-emerald-600">
                          <Check className="h-3.5 w-3.5" />
                          Recorded
                        </span>
                      ) : r.status === 'failed' ? (
                        <span
                          className="inline-flex items-center gap-1 text-xs text-destructive"
                          title={r.errorMessage ?? undefined}
                        >
                          <X className="h-3.5 w-3.5" />
                          Failed
                        </span>
                      ) : r.match ? (
                        <div className="flex items-center justify-end gap-2">
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            value={r.amountToRecord}
                            onChange={(e) =>
                              patchRow(r.row.index, {
                                amountToRecord: e.target.value,
                              })
                            }
                            className="h-7 w-24 text-right text-xs"
                          />
                          <label className="flex items-center gap-1 text-xs">
                            <input
                              type="checkbox"
                              checked={r.confirmed}
                              onChange={(e) =>
                                patchRow(r.row.index, {
                                  confirmed: e.target.checked,
                                })
                              }
                              className="h-3.5 w-3.5 rounded border-border accent-primary"
                            />
                            Confirm
                          </label>
                        </div>
                      ) : (
                        <span className="text-[11px] text-muted-foreground">
                          Skip: record manually if needed.
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setRows([])}
              disabled={submitting}
            >
              Clear
            </Button>
            <Button
              type="button"
              onClick={submit}
              disabled={submitting || summary.confirmed === 0}
              className="gap-1.5"
            >
              {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Record {summary.confirmed}{' '}
              {summary.confirmed === 1 ? 'payment' : 'payments'}
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
