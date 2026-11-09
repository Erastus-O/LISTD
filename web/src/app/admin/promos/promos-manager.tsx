'use client'

import { useState } from 'react'
import {
  BadgePercent,
  CalendarClock,
  Loader2,
  Plus,
  Search,
  Tag,
  Trash2,
  Users,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

export type PromoRow = {
  id: string
  code: string
  kind: string
  percentOff: number | null
  serviceTypes: string[] | null
  startsAt: string | null
  expiresAt: string | null
  maxRedemptions: number | null
  redemptionCount: number
  enabled: boolean
  assignedClientIds: string[] | null
  notes: string | null
  createdAt: string
}

type ServiceOption = { key: string; label: string }
type ClientOption = { userId: string; name: string }

/**
 * Searchable checkbox list of client accounts, shared by the create form
 * and the per-row assignment editor.
 */
function ClientPicker({
  options,
  selected,
  onToggle,
}: {
  options: ClientOption[]
  selected: string[]
  onToggle: (userId: string) => void
}) {
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const filtered = q
    ? options.filter((o) => o.name.toLowerCase().includes(q))
    : options

  return (
    <div className="space-y-2">
      {selected.length > 0 && (
        <p className="text-xs font-medium text-foreground">
          {selected.length} client{selected.length === 1 ? '' : 's'} selected
        </p>
      )}
      {options.length > 6 && (
        <div className="relative">
          <Search className="absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search clients…"
            className="h-8 pl-8 text-xs"
          />
        </div>
      )}
      <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border border-border p-1.5">
        {filtered.length === 0 ? (
          <p className="p-2 text-xs text-muted-foreground">
            No clients match your search.
          </p>
        ) : (
          filtered.map((c) => (
            <label
              key={c.userId}
              className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-muted/40"
            >
              <input
                type="checkbox"
                checked={selected.includes(c.userId)}
                onChange={() => onToggle(c.userId)}
                className="h-3.5 w-3.5 accent-primary"
              />
              <span className="truncate text-foreground">{c.name}</span>
            </label>
          ))
        )}
      </div>
    </div>
  )
}

const EMPTY_FORM = {
  code: '',
  kind: 'discount' as 'discount' | 'invoice_later',
  percentOff: '10',
  serviceTypes: [] as string[],
  assignedClientIds: [] as string[],
  startsAt: '',
  expiresAt: '',
  maxRedemptions: '',
  notes: '',
}

/**
 * Client half of /admin/promos: create form + management list. Lifecycle
 * actions (enable/disable, edit expiry, delete-while-unused) PATCH/DELETE
 * /api/admin/promos/[id]; creation POSTs /api/admin/promos.
 */
export function PromosManager({
  initialPromos,
  serviceOptions,
  clientOptions,
}: {
  initialPromos: PromoRow[]
  serviceOptions: ServiceOption[]
  clientOptions: ClientOption[]
}) {
  const [promos, setPromos] = useState<PromoRow[]>(initialPromos)
  // Expiry badges compare against mount time — stable across re-renders
  // (react-hooks/purity forbids Date.now() in render).
  const [nowMs] = useState(() => Date.now())
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  // Inline "edit assigned clients" state for an existing code.
  const [editAssign, setEditAssign] = useState<{
    id: string
    selected: string[]
  } | null>(null)

  const labelFor = (key: string) =>
    serviceOptions.find((o) => o.key === key)?.label ?? key
  const clientName = (id: string) =>
    clientOptions.find((c) => c.userId === id)?.name ?? 'Unknown client'

  function toggleScope(key: string) {
    setForm((f) => ({
      ...f,
      serviceTypes: f.serviceTypes.includes(key)
        ? f.serviceTypes.filter((k) => k !== key)
        : [...f.serviceTypes, key],
    }))
  }

  async function create() {
    if (saving) return
    setSaving(true)
    try {
      const res = await fetch('/api/admin/promos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: form.code,
          kind: form.kind,
          ...(form.kind === 'discount'
            ? {
                percentOff: parseInt(form.percentOff, 10) || undefined,
                serviceTypes: form.serviceTypes,
              }
            : {}),
          ...(form.startsAt
            ? { startsAt: new Date(form.startsAt).toISOString() }
            : {}),
          ...(form.expiresAt
            ? { expiresAt: new Date(form.expiresAt).toISOString() }
            : {}),
          ...(form.maxRedemptions
            ? { maxRedemptions: parseInt(form.maxRedemptions, 10) }
            : {}),
          ...(form.assignedClientIds.length
            ? { assignedClientIds: form.assignedClientIds }
            : {}),
          ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
        }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`)
      setPromos((list) => [json.promo as PromoRow, ...list])
      setForm(EMPTY_FORM)
      setShowForm(false)
      toast.success('Promo code created', {
        description: (json.promo as PromoRow).code,
      })
    } catch (err) {
      toast.error('Could not create the code', {
        description: err instanceof Error ? err.message : 'Please try again.',
      })
    } finally {
      setSaving(false)
    }
  }

  async function patch(id: string, changes: Record<string, unknown>) {
    setBusyId(id)
    try {
      const res = await fetch(`/api/admin/promos/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(changes),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`)
      setPromos((list) =>
        list.map((p) => (p.id === id ? (json.promo as PromoRow) : p))
      )
    } catch (err) {
      toast.error('Could not update the code', {
        description: err instanceof Error ? err.message : 'Please try again.',
      })
    } finally {
      setBusyId(null)
    }
  }

  async function remove(id: string) {
    setBusyId(id)
    try {
      const res = await fetch(`/api/admin/promos/${id}`, { method: 'DELETE' })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`)
      setPromos((list) => list.filter((p) => p.id !== id))
      toast.success('Promo code deleted')
    } catch (err) {
      toast.error('Could not delete the code', {
        description: err instanceof Error ? err.message : 'Please try again.',
      })
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button
          type="button"
          size="sm"
          onClick={() => setShowForm((v) => !v)}
          className="gap-1.5"
          variant={showForm ? 'outline' : 'default'}
        >
          {showForm ? (
            <>
              <X className="h-3.5 w-3.5" />
              Cancel
            </>
          ) : (
            <>
              <Plus className="h-3.5 w-3.5" />
              New promo code
            </>
          )}
        </Button>
      </div>

      {showForm && (
        <Card>
          <CardContent className="space-y-4 p-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="promo-code">Code</Label>
                <Input
                  id="promo-code"
                  value={form.code}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      code: e.target.value.toUpperCase().replace(/\s+/g, ''),
                    }))
                  }
                  placeholder="e.g. LISTD10 or ACME-MONTHLY"
                  className="uppercase"
                  maxLength={40}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="promo-kind">Type</Label>
                <select
                  id="promo-kind"
                  value={form.kind}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      kind: e.target.value as typeof f.kind,
                    }))
                  }
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="discount">Percentage discount</option>
                  <option value="invoice_later">
                    Monthly account (post now, invoice at month end)
                  </option>
                </select>
              </div>
            </div>

            {form.kind === 'discount' ? (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="promo-pct">Discount %</Label>
                  <Input
                    id="promo-pct"
                    type="number"
                    min={1}
                    max={100}
                    value={form.percentOff}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, percentOff: e.target.value }))
                    }
                    className="max-w-30"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Applies to services</Label>
                  <p className="text-xs text-muted-foreground">
                    Leave all unticked to apply the discount to every service.
                  </p>
                  <div className="grid gap-1.5 sm:grid-cols-2">
                    {serviceOptions.map((o) => (
                      <label
                        key={o.key}
                        className="flex cursor-pointer items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-xs hover:bg-muted/40"
                      >
                        <input
                          type="checkbox"
                          checked={form.serviceTypes.includes(o.key)}
                          onChange={() => toggleScope(o.key)}
                          className="h-3.5 w-3.5 accent-primary"
                        />
                        <span className="text-foreground">{o.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <p className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-xs text-muted-foreground">
                Clients using this code post jobs <strong>without paying</strong>.
                The balance shows on their dashboard and is swept into one
                consolidated invoice with a secure payment link on the 1st of
                each month, with automatic reminders until it&rsquo;s paid.
                Pros on these jobs are paid at month end and see the amount due
                on their dashboard.
              </p>
            )}

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="promo-starts">Starts (optional)</Label>
                <Input
                  id="promo-starts"
                  type="datetime-local"
                  value={form.startsAt}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, startsAt: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="promo-expires">Expires (optional)</Label>
                <Input
                  id="promo-expires"
                  type="datetime-local"
                  value={form.expiresAt}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, expiresAt: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="promo-max">Max uses (optional)</Label>
                <Input
                  id="promo-max"
                  type="number"
                  min={1}
                  value={form.maxRedemptions}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, maxRedemptions: e.target.value }))
                  }
                  placeholder="Unlimited"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Assign to clients (optional)</Label>
              <p className="text-xs text-muted-foreground">
                Leave empty for a public code anyone can type. When assigned,
                the code is private to these clients and applies automatically
                on their bookings.
              </p>
              <ClientPicker
                options={clientOptions}
                selected={form.assignedClientIds}
                onToggle={(id) =>
                  setForm((f) => ({
                    ...f,
                    assignedClientIds: f.assignedClientIds.includes(id)
                      ? f.assignedClientIds.filter((x) => x !== id)
                      : [...f.assignedClientIds, id],
                  }))
                }
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="promo-notes">Internal notes (optional)</Label>
              <Textarea
                id="promo-notes"
                value={form.notes}
                onChange={(e) =>
                  setForm((f) => ({ ...f, notes: e.target.value }))
                }
                placeholder="Who this code is for, campaign, agreement reference…"
                rows={2}
                maxLength={500}
              />
            </div>

            <div className="flex justify-end">
              <Button
                type="button"
                onClick={create}
                disabled={
                  saving ||
                  form.code.trim().length < 3 ||
                  (form.kind === 'discount' &&
                    !(parseInt(form.percentOff, 10) >= 1))
                }
                className="gap-1.5"
              >
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Create code
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {promos.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center">
            <Tag className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" />
            <p className="text-sm font-medium text-foreground">
              No promo codes yet
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Create your first code to offer discounts or monthly-account
              posting.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {promos.map((p) => {
            const expired =
              !!p.expiresAt && new Date(p.expiresAt).getTime() < nowMs
            const capped =
              p.maxRedemptions !== null &&
              p.redemptionCount >= p.maxRedemptions
            const live = p.enabled && !expired && !capped
            const busy = busyId === p.id
            const assigned = p.assignedClientIds ?? []
            return (
              <Card key={p.id}>
                <CardContent className="flex flex-wrap items-start justify-between gap-4 p-4">
                  <div className="min-w-0 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-bold text-foreground">
                        {p.code}
                      </span>
                      {p.kind === 'invoice_later' ? (
                        <Badge variant="secondary" className="gap-1 text-[10px]">
                          <CalendarClock className="h-3 w-3" />
                          Monthly account
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="gap-1 text-[10px]">
                          <BadgePercent className="h-3 w-3" />
                          {p.percentOff}% off
                        </Badge>
                      )}
                      <Badge
                        variant={live ? 'default' : 'outline'}
                        className="text-[10px]"
                      >
                        {live
                          ? 'Active'
                          : expired
                            ? 'Expired'
                            : capped
                              ? 'Fully redeemed'
                              : 'Disabled'}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {p.kind === 'discount' &&
                        (p.serviceTypes?.length
                          ? `Applies to: ${p.serviceTypes.map(labelFor).join(', ')}`
                          : 'Applies to all services')}
                      {p.kind === 'invoice_later' &&
                        'Post without paying — consolidated month-end invoice'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {assigned.length > 0
                        ? `Private — auto-applies for: ${assigned
                            .slice(0, 3)
                            .map(clientName)
                            .join(', ')}${
                            assigned.length > 3
                              ? ` +${assigned.length - 3} more`
                              : ''
                          }`
                        : 'Public — any client can enter this code'}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      Used {p.redemptionCount}
                      {p.maxRedemptions !== null ? ` of ${p.maxRedemptions}` : ''}
                      {p.startsAt &&
                        ` · from ${new Date(p.startsAt).toLocaleDateString('en-GB')}`}
                      {p.expiresAt &&
                        ` · expires ${new Date(p.expiresAt).toLocaleDateString(
                          'en-GB',
                          { day: 'numeric', month: 'short', year: 'numeric' }
                        )}`}
                      {p.notes ? ` · ${p.notes}` : ''}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        setEditAssign((cur) =>
                          cur?.id === p.id
                            ? null
                            : { id: p.id, selected: assigned }
                        )
                      }
                      className="h-8 gap-1 text-xs"
                    >
                      <Users className="h-3 w-3" />
                      {editAssign?.id === p.id ? 'Close' : 'Clients'}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => patch(p.id, { enabled: !p.enabled })}
                      className="h-8 text-xs"
                    >
                      {busy ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : p.enabled ? (
                        'Disable'
                      ) : (
                        'Enable'
                      )}
                    </Button>
                    {p.redemptionCount === 0 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onClick={() => remove(p.id)}
                        className="h-8 gap-1 text-xs text-destructive hover:text-destructive"
                      >
                        <Trash2 className="h-3 w-3" />
                        Delete
                      </Button>
                    )}
                  </div>

                  {editAssign?.id === p.id && (
                    <div className="w-full space-y-2 border-t border-border pt-3">
                      <p className="text-xs text-muted-foreground">
                        Tick the clients this code belongs to — it will apply
                        automatically on their bookings. Untick everyone to
                        make the code public again.
                      </p>
                      <ClientPicker
                        options={clientOptions}
                        selected={editAssign.selected}
                        onToggle={(id) =>
                          setEditAssign((cur) =>
                            cur && cur.id === p.id
                              ? {
                                  ...cur,
                                  selected: cur.selected.includes(id)
                                    ? cur.selected.filter((x) => x !== id)
                                    : [...cur.selected, id],
                                }
                              : cur
                          )
                        }
                      />
                      <div className="flex justify-end">
                        <Button
                          type="button"
                          size="sm"
                          disabled={busy}
                          onClick={async () => {
                            await patch(p.id, {
                              assignedClientIds: editAssign.selected,
                            })
                            setEditAssign(null)
                            toast.success('Assignment updated')
                          }}
                          className="h-8 gap-1.5 text-xs"
                        >
                          {busy && (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          )}
                          Save clients
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
