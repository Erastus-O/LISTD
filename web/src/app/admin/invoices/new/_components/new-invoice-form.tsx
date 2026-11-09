'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Plus, Search, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

export type TaxRateOption = {
  id: string
  code: string
  name: string
  /** Decimal fraction, e.g. 0.2 for 20 %. */
  rate: number
  isDefault: boolean
}

export type SeedClient = {
  userId: string
  fullName: string
  companyName: string | null
}

export type SeedLine = {
  description: string
  quantity: number
  unitPrice: number
  taxRateId: string | null
  jobId: string | null
}

type FormLine = {
  /** Stable id for React keys; not sent to the API. */
  rowKey: string
  description: string
  quantity: string
  unitPrice: string
  taxRateId: string | null
  jobId: string | null
}

type ClientSuggestion = {
  userId: string
  fullName: string
  companyName: string | null
}

const NONE_RATE = '__none__'
const CURRENCY = 'GBP'

/**
 * Manual create-invoice form. Drives `POST /api/billing/invoices` and
 * redirects to the new draft's detail page on success.
 *
 * Three regions:
 *   1. Client picker — typeahead unless seeded from a job (then locked).
 *   2. Line items     — add/remove rows, live subtotal + tax preview per row.
 *   3. Notes          — free text rendered on the PDF.
 *
 * The live totals panel mirrors the calculation the server does in
 * `inbuilt/provider.ts → computeLineRows` so the admin sees exactly what
 * will be saved.
 */
export function NewInvoiceForm({
  rates,
  defaultRateId,
  seedClient,
  seedLines,
}: {
  rates: TaxRateOption[]
  defaultRateId: string | null
  seedClient: SeedClient | null
  seedLines: SeedLine[] | null
}) {
  const router = useRouter()
  const [client, setClient] = useState<SeedClient | null>(seedClient)
  const [clientSearch, setClientSearch] = useState('')
  const [clientResults, setClientResults] = useState<ClientSuggestion[]>([])
  const [searchPending, setSearchPending] = useState(false)
  const lockedClient = !!seedClient

  const [lines, setLines] = useState<FormLine[]>(() =>
    (seedLines && seedLines.length > 0 ? seedLines : [blankLine(defaultRateId)]).map(
      (l, i) => ({
        rowKey: `seed-${i}`,
        description: 'description' in l ? l.description : '',
        quantity:
          'quantity' in l && Number.isFinite(l.quantity)
            ? String(l.quantity)
            : '1',
        unitPrice:
          'unitPrice' in l && Number.isFinite(l.unitPrice)
            ? l.unitPrice.toFixed(2)
            : '0.00',
        taxRateId: 'taxRateId' in l ? l.taxRateId : defaultRateId,
        jobId: 'jobId' in l ? l.jobId : null,
      })
    )
  )
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Debounced client typeahead. Mirrors the pattern in send-notification-card.
  useEffect(() => {
    if (lockedClient) return
    if (clientSearch.trim().length < 2) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setClientResults((prev) => (prev.length === 0 ? prev : []))
      return
    }
    const handle = setTimeout(async () => {
      setSearchPending(true)
      try {
        const res = await fetch(
          `/api/admin/billing/search-clients?q=${encodeURIComponent(
            clientSearch.trim()
          )}`
        )
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = (await res.json()) as { results: ClientSuggestion[] }
        setClientResults(json.results ?? [])
      } catch {
        setClientResults([])
      } finally {
        setSearchPending(false)
      }
    }, 250)
    return () => clearTimeout(handle)
  }, [clientSearch, lockedClient])

  const rateById = useMemo(
    () => new Map(rates.map((r) => [r.id, r])),
    [rates]
  )

  const totals = useMemo(() => {
    let subtotal = 0
    let tax = 0
    for (const l of lines) {
      const qty = Number.parseFloat(l.quantity)
      const unit = Number.parseFloat(l.unitPrice)
      if (!Number.isFinite(qty) || !Number.isFinite(unit)) continue
      const lineSub = round2(qty * unit)
      const rate = l.taxRateId ? rateById.get(l.taxRateId) : null
      const lineTax = round2(lineSub * (rate?.rate ?? 0))
      subtotal += lineSub
      tax += lineTax
    }
    return { subtotal: round2(subtotal), tax: round2(tax), total: round2(subtotal + tax) }
  }, [lines, rateById])

  const canSubmit =
    !!client &&
    lines.length > 0 &&
    lines.every(
      (l) =>
        l.description.trim().length > 0 &&
        Number.parseFloat(l.quantity) > 0 &&
        Number.isFinite(Number.parseFloat(l.unitPrice)) &&
        Number.parseFloat(l.unitPrice) >= 0
    ) &&
    !submitting

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit || !client) return
    setSubmitting(true)
    try {
      const res = await fetch('/api/billing/invoices', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          clientId: client.userId,
          notes: notes.trim() || null,
          lineItems: lines.map((l, i) => ({
            description: l.description.trim(),
            quantity: Number.parseFloat(l.quantity),
            unitPrice: Number.parseFloat(l.unitPrice),
            taxRateId: l.taxRateId,
            jobId: l.jobId,
            position: i,
          })),
        }),
      })
      const json = (await res.json().catch(() => ({}))) as {
        invoice?: { id: string }
        error?: string
      }
      if (!res.ok) {
        throw new Error(json.error ?? `HTTP ${res.status}`)
      }
      if (!json.invoice?.id) throw new Error('Server returned no invoice id')
      toast.success('Draft invoice created')
      router.push(`/admin/invoices/${json.invoice.id}`)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create invoice')
      setSubmitting(false)
    }
  }

  function patchLine(rowKey: string, patch: Partial<FormLine>) {
    setLines((prev) =>
      prev.map((l) => (l.rowKey === rowKey ? { ...l, ...patch } : l))
    )
  }

  function addLine() {
    setLines((prev) => [
      ...prev,
      {
        rowKey: `r-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        description: '',
        quantity: '1',
        unitPrice: '0.00',
        taxRateId: defaultRateId,
        jobId: null,
      },
    ])
  }

  function removeLine(rowKey: string) {
    setLines((prev) =>
      prev.length === 1 ? prev : prev.filter((l) => l.rowKey !== rowKey)
    )
  }

  return (
    <form className="space-y-6" onSubmit={handleSubmit}>
      {/* ── Client ─────────────────────────────────────────────────── */}
      <section className="space-y-2">
        <Label className="text-xs uppercase tracking-wide text-muted-foreground">
          Bill to
        </Label>
        {lockedClient && client ? (
          <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
            <p className="font-medium text-foreground">
              {client.companyName ?? client.fullName}
            </p>
            {client.companyName && (
              <p className="text-xs text-muted-foreground">{client.fullName}</p>
            )}
            <p className="mt-1 text-[11px] text-muted-foreground">
              Seeded from job: change requires starting from a different job.
            </p>
          </div>
        ) : client ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-muted/30 p-3 text-sm">
            <div>
              <p className="font-medium text-foreground">
                {client.companyName ?? client.fullName}
              </p>
              {client.companyName && (
                <p className="text-xs text-muted-foreground">{client.fullName}</p>
              )}
            </div>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setClient(null)}
            >
              Change
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={clientSearch}
                onChange={(e) => setClientSearch(e.target.value)}
                placeholder="Search by name or company…"
                className="h-9 pl-9 text-sm"
                autoComplete="off"
              />
            </div>
            {searchPending && (
              <p className="text-xs text-muted-foreground">Searching…</p>
            )}
            {clientResults.length > 0 && (
              <ul className="max-h-56 overflow-y-auto rounded-md border border-border">
                {clientResults.map((r) => (
                  <li key={r.userId}>
                    <button
                      type="button"
                      onClick={() => {
                        setClient(r)
                        setClientResults([])
                        setClientSearch('')
                      }}
                      className="block w-full px-3 py-2 text-left text-sm hover:bg-muted/50"
                    >
                      <span className="font-medium text-foreground">
                        {r.companyName ?? r.fullName}
                      </span>
                      {r.companyName && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          {r.fullName}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {clientSearch.trim().length >= 2 &&
              !searchPending &&
              clientResults.length === 0 && (
                <p className="text-xs text-muted-foreground">No matches.</p>
              )}
          </div>
        )}
      </section>

      {/* ── Line items ────────────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">
            Line items
          </Label>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={addLine}
          >
            <Plus className="h-3.5 w-3.5" />
            Add line
          </Button>
        </div>

        <div className="space-y-3">
          {lines.map((l, idx) => {
            const qty = Number.parseFloat(l.quantity)
            const unit = Number.parseFloat(l.unitPrice)
            const lineSub =
              Number.isFinite(qty) && Number.isFinite(unit)
                ? round2(qty * unit)
                : 0
            const rate = l.taxRateId ? rateById.get(l.taxRateId) : null
            const lineTax = round2(lineSub * (rate?.rate ?? 0))
            return (
              <div
                key={l.rowKey}
                className="grid gap-2 rounded-md border border-border p-3 md:grid-cols-[1fr_80px_120px_180px_auto]"
              >
                <div>
                  <Label
                    htmlFor={`desc-${l.rowKey}`}
                    className="text-[10px] uppercase tracking-wide text-muted-foreground"
                  >
                    Description
                  </Label>
                  <Input
                    id={`desc-${l.rowKey}`}
                    value={l.description}
                    onChange={(e) =>
                      patchLine(l.rowKey, { description: e.target.value })
                    }
                    placeholder="e.g. Mid-term inspection · 12 Acacia Ave"
                    className="h-9 text-sm"
                  />
                </div>
                <div>
                  <Label
                    htmlFor={`qty-${l.rowKey}`}
                    className="text-[10px] uppercase tracking-wide text-muted-foreground"
                  >
                    Qty
                  </Label>
                  <Input
                    id={`qty-${l.rowKey}`}
                    type="number"
                    min="0"
                    step="0.01"
                    value={l.quantity}
                    onChange={(e) =>
                      patchLine(l.rowKey, { quantity: e.target.value })
                    }
                    className="h-9 text-sm"
                  />
                </div>
                <div>
                  <Label
                    htmlFor={`price-${l.rowKey}`}
                    className="text-[10px] uppercase tracking-wide text-muted-foreground"
                  >
                    Unit price
                  </Label>
                  <Input
                    id={`price-${l.rowKey}`}
                    type="number"
                    min="0"
                    step="0.01"
                    value={l.unitPrice}
                    onChange={(e) =>
                      patchLine(l.rowKey, { unitPrice: e.target.value })
                    }
                    className="h-9 text-sm"
                  />
                </div>
                <div>
                  <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    Tax rate
                  </Label>
                  <Select
                    value={l.taxRateId ?? NONE_RATE}
                    onValueChange={(v) =>
                      patchLine(l.rowKey, {
                        taxRateId: v === NONE_RATE ? null : v,
                      })
                    }
                  >
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue placeholder="No tax" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE_RATE}>No tax</SelectItem>
                      {rates.map((r) => (
                        <SelectItem key={r.id} value={r.id}>
                          {r.name} ({(r.rate * 100).toFixed(0)}%)
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-end justify-between gap-2 md:flex-col md:items-end">
                  <div className="text-right text-[11px] text-muted-foreground">
                    <p>
                      Sub: <span className="text-foreground">{formatMoney(lineSub)}</span>
                    </p>
                    {rate && (
                      <p>
                        Tax: <span className="text-foreground">{formatMoney(lineTax)}</span>
                      </p>
                    )}
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => removeLine(l.rowKey)}
                    disabled={lines.length === 1}
                    aria-label={`Remove line ${idx + 1}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {/* ── Notes ─────────────────────────────────────────────────── */}
      <section className="space-y-2">
        <Label
          htmlFor="invoice-notes"
          className="text-xs uppercase tracking-wide text-muted-foreground"
        >
          Notes (optional)
        </Label>
        <Textarea
          id="invoice-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Payment terms, internal references, etc. Rendered on the PDF."
          rows={3}
          maxLength={2000}
          className="text-sm"
        />
      </section>

      {/* ── Totals + actions ──────────────────────────────────────── */}
      <section className="space-y-2 rounded-md border border-border bg-muted/20 p-4 text-sm">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Subtotal</span>
          <span>{formatMoney(totals.subtotal)}</span>
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Tax</span>
          <span>{formatMoney(totals.tax)}</span>
        </div>
        <div className="flex items-center justify-between border-t border-border pt-1.5 text-sm font-semibold">
          <span>Total</span>
          <span>{formatMoney(totals.total)}</span>
        </div>
      </section>

      <div className="flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          onClick={() => router.push('/admin/invoices')}
          disabled={submitting}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={!canSubmit} className="gap-1.5">
          {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Save draft
        </Button>
      </div>
    </form>
  )
}

function blankLine(defaultRateId: string | null): SeedLine {
  return {
    description: '',
    quantity: 1,
    unitPrice: 0,
    taxRateId: defaultRateId,
    jobId: null,
  }
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: CURRENCY,
  }).format(value)
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
