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
  rate: number
  isDefault: boolean
}

type Cadence = 'monthly' | 'weekly' | 'quarterly'
type AutoAction = 'draft' | 'issued' | 'sent'

type ClientSuggestion = {
  userId: string
  fullName: string
  companyName: string | null
}

type FormLine = {
  rowKey: string
  description: string
  quantity: string
  unitPrice: string
  taxRateId: string | null
}

const NONE_RATE = '__none__'
const WEEKDAYS = [
  { v: 0, l: 'Sunday' },
  { v: 1, l: 'Monday' },
  { v: 2, l: 'Tuesday' },
  { v: 3, l: 'Wednesday' },
  { v: 4, l: 'Thursday' },
  { v: 5, l: 'Friday' },
  { v: 6, l: 'Saturday' },
]

/**
 * Create-template form. Posts to /api/admin/billing/recurring. On success
 * redirects back to the index — the new row's `next_run_at` is in the
 * response but the index re-fetches to surface it.
 */
export function NewRecurringForm({
  rates,
  defaultRateId,
}: {
  rates: TaxRateOption[]
  defaultRateId: string | null
}) {
  const router = useRouter()

  const [client, setClient] = useState<ClientSuggestion | null>(null)
  const [clientSearch, setClientSearch] = useState('')
  const [clientResults, setClientResults] = useState<ClientSuggestion[]>([])
  const [searchPending, setSearchPending] = useState(false)

  const [cadence, setCadence] = useState<Cadence>('monthly')
  const [dayOfMonth, setDayOfMonth] = useState('1')
  const [dayOfWeek, setDayOfWeek] = useState('1')
  const [startsOn, setStartsOn] = useState('')
  const [endsOn, setEndsOn] = useState('')
  const [autoAction, setAutoAction] = useState<AutoAction>('issued')
  const [notes, setNotes] = useState('')

  const [lines, setLines] = useState<FormLine[]>(() => [blankLine(defaultRateId)])
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (clientSearch.trim().length < 2) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setClientResults((prev) => (prev.length === 0 ? prev : []))
      return
    }
    const handle = setTimeout(async () => {
      setSearchPending(true)
      try {
        const res = await fetch(
          `/api/admin/billing/search-clients?q=${encodeURIComponent(clientSearch.trim())}`
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
  }, [clientSearch])

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
      const res = await fetch('/api/admin/billing/recurring', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          clientId: client.userId,
          cadence,
          dayOfMonth: cadence === 'weekly' ? null : Number.parseInt(dayOfMonth, 10),
          dayOfWeek: cadence === 'weekly' ? Number.parseInt(dayOfWeek, 10) : null,
          startsOn: startsOn || undefined,
          endsOn: endsOn || null,
          autoAction,
          notes: notes.trim() || null,
          lineItems: lines.map((l, i) => ({
            description: l.description.trim(),
            quantity: Number.parseFloat(l.quantity),
            unitPrice: Number.parseFloat(l.unitPrice),
            taxRateId: l.taxRateId,
            position: i,
          })),
        }),
      })
      const json = (await res.json().catch(() => ({}))) as {
        id?: string
        nextRunAt?: string
        error?: string
      }
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
      toast.success('Recurring template created', {
        description: json.nextRunAt
          ? `First fire scheduled for ${json.nextRunAt}.`
          : undefined,
      })
      router.push('/admin/billing/recurring')
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create')
      setSubmitting(false)
    }
  }

  function patchLine(rowKey: string, patch: Partial<FormLine>) {
    setLines((prev) =>
      prev.map((l) => (l.rowKey === rowKey ? { ...l, ...patch } : l))
    )
  }
  function addLine() {
    setLines((prev) => [...prev, blankLine(defaultRateId)])
  }
  function removeLine(rowKey: string) {
    setLines((prev) =>
      prev.length === 1 ? prev : prev.filter((l) => l.rowKey !== rowKey)
    )
  }

  return (
    <form className="space-y-6" onSubmit={handleSubmit}>
      <section className="space-y-2">
        <Label className="text-xs uppercase tracking-wide text-muted-foreground">
          Bill to
        </Label>
        {client ? (
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
          </div>
        )}
      </section>

      <section className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">
            Cadence
          </Label>
          <Select value={cadence} onValueChange={(v) => setCadence(v as Cadence)}>
            <SelectTrigger className="h-9 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="weekly">Weekly</SelectItem>
              <SelectItem value="monthly">Monthly</SelectItem>
              <SelectItem value="quarterly">Quarterly (every 3 months)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {cadence === 'weekly' ? (
          <div>
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              Day of week
            </Label>
            <Select value={dayOfWeek} onValueChange={setDayOfWeek}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WEEKDAYS.map((d) => (
                  <SelectItem key={d.v} value={String(d.v)}>
                    {d.l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : (
          <div>
            <Label
              htmlFor="rec-dom"
              className="text-xs uppercase tracking-wide text-muted-foreground"
            >
              Day of month (1–28)
            </Label>
            <Input
              id="rec-dom"
              type="number"
              min="1"
              max="28"
              value={dayOfMonth}
              onChange={(e) => setDayOfMonth(e.target.value)}
              className="h-9 text-sm"
            />
          </div>
        )}
        <div>
          <Label
            htmlFor="rec-starts"
            className="text-xs uppercase tracking-wide text-muted-foreground"
          >
            Starts on (optional)
          </Label>
          <Input
            id="rec-starts"
            type="date"
            value={startsOn}
            onChange={(e) => setStartsOn(e.target.value)}
            className="h-9 text-sm"
          />
        </div>
        <div>
          <Label
            htmlFor="rec-ends"
            className="text-xs uppercase tracking-wide text-muted-foreground"
          >
            Ends on (optional)
          </Label>
          <Input
            id="rec-ends"
            type="date"
            value={endsOn}
            onChange={(e) => setEndsOn(e.target.value)}
            className="h-9 text-sm"
          />
        </div>
        <div className="sm:col-span-2">
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">
            Auto action
          </Label>
          <Select
            value={autoAction}
            onValueChange={(v) => setAutoAction(v as AutoAction)}
          >
            <SelectTrigger className="h-9 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="draft">
                Mint draft (admin reviews and issues manually)
              </SelectItem>
              <SelectItem value="issued">
                Auto-issue (allocates reference, renders PDF)
              </SelectItem>
              <SelectItem value="sent">
                Auto-issue and email the client
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </section>

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

        {lines.map((l, idx) => (
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
                placeholder="e.g. Monthly retainer · property portfolio"
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
            <div className="flex items-end justify-end">
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
        ))}
      </section>

      <section className="space-y-2">
        <Label
          htmlFor="rec-notes"
          className="text-xs uppercase tracking-wide text-muted-foreground"
        >
          Notes (optional)
        </Label>
        <Textarea
          id="rec-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          maxLength={2000}
          placeholder="Rendered on every minted invoice's PDF."
          className="text-sm"
        />
      </section>

      <section className="rounded-md border border-border bg-muted/20 p-4 text-sm">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Per-fire total</span>
          <span className="font-mono">
            £{totals.total.toFixed(2)}{' '}
            <span className="text-muted-foreground">
              ({totals.subtotal.toFixed(2)} + {totals.tax.toFixed(2)} tax)
            </span>
          </span>
        </div>
      </section>

      <div className="flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          onClick={() => router.push('/admin/billing/recurring')}
          disabled={submitting}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={!canSubmit} className="gap-1.5">
          {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Save template
        </Button>
      </div>
    </form>
  )
}

function blankLine(defaultRateId: string | null): FormLine {
  return {
    rowKey: `r-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    description: '',
    quantity: '1',
    unitPrice: '0.00',
    taxRateId: defaultRateId,
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
