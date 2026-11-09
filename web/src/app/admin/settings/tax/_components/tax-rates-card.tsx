'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Loader2, Pencil, Plus, Star, X } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export type TaxRateRow = {
  id: string
  code: string
  name: string
  rate: number
  isActive: boolean
  isDefault: boolean
  appliesTo: string
  notes: string | null
  /** Xero TaxType string (e.g. `OUTPUT2`). Surfaced so the admin can
   *  configure the LISTD-to-Xero mapping in one place. */
  xeroTaxType: string | null
}

type DialogMode =
  | { kind: 'closed' }
  | { kind: 'create' }
  | { kind: 'edit'; row: TaxRateRow }

/**
 * Tax-rate library card with inline-toggle and modal create/edit. Mutating
 * actions hit /api/admin/billing/tax-rates(/:id). After each success we
 * `router.refresh()` so the server-fetched rows reflect the change without
 * needing a client store.
 */
export function TaxRatesCard({ rows }: { rows: TaxRateRow[] }) {
  const router = useRouter()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [dialog, setDialog] = useState<DialogMode>({ kind: 'closed' })

  async function patch(id: string, body: Record<string, unknown>, optimistic?: string) {
    setBusyId(id)
    try {
      const res = await fetch(`/api/admin/billing/tax-rates/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as {
          error?: string
        } | null
        throw new Error(json?.error ?? `HTTP ${res.status}`)
      }
      if (optimistic) toast.success(optimistic)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Update failed')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="gap-1.5"
          onClick={() => setDialog({ kind: 'create' })}
        >
          <Plus className="h-3.5 w-3.5" />
          Add rate
        </Button>
      </div>

      {rows.length === 0 ? (
        <p className="py-6 text-center text-xs text-muted-foreground">
          No tax rates configured. Add one to enable taxed line items.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Code</th>
                <th className="px-3 py-2 text-left font-medium">Name</th>
                <th className="px-3 py-2 text-right font-medium">Rate</th>
                <th className="px-3 py-2 text-left font-medium">Xero</th>
                <th className="px-3 py-2 text-left font-medium">Status</th>
                <th className="px-3 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => {
                const busy = busyId === r.id
                return (
                  <tr key={r.id} className="hover:bg-muted/30">
                    <td className="px-3 py-2 font-mono text-xs">{r.code}</td>
                    <td className="px-3 py-2 text-xs">
                      <div className="flex items-center gap-2">
                        <span>{r.name}</span>
                        {r.isDefault && (
                          <Badge variant="secondary" className="gap-1 text-[10px]">
                            <Star className="h-3 w-3" /> Default
                          </Badge>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right text-xs">
                      {(r.rate * 100).toFixed(2).replace(/\.00$/, '')}%
                    </td>
                    <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">
                      {r.xeroTaxType ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {r.isActive ? (
                        <Badge variant="default" className="text-[10px]">
                          Active
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px]">
                          Inactive
                        </Badge>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {!r.isDefault && r.isActive && (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            onClick={() =>
                              patch(r.id, { isDefault: true }, 'Default rate updated')
                            }
                            title="Mark as default"
                          >
                            <Star className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() =>
                            patch(
                              r.id,
                              { isActive: !r.isActive },
                              r.isActive ? 'Rate deactivated' : 'Rate activated'
                            )
                          }
                          title={r.isActive ? 'Deactivate' : 'Reactivate'}
                        >
                          {r.isActive ? (
                            <X className="h-3.5 w-3.5" />
                          ) : (
                            <Check className="h-3.5 w-3.5" />
                          )}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => setDialog({ kind: 'edit', row: r })}
                          title="Edit"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        {busy && (
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {dialog.kind !== 'closed' && (
        <TaxRateDialog
          // Force a remount whenever the target row changes, which resets
          // every input's initial state. Cleaner than seeding via useEffect.
          key={dialog.kind === 'edit' ? `edit-${dialog.row.id}` : 'create'}
          existing={dialog.kind === 'edit' ? dialog.row : null}
          onClose={() => setDialog({ kind: 'closed' })}
          onSaved={() => {
            setDialog({ kind: 'closed' })
            router.refresh()
          }}
        />
      )}
    </div>
  )
}

function TaxRateDialog({
  existing,
  onClose,
  onSaved,
}: {
  existing: TaxRateRow | null
  onClose: () => void
  onSaved: () => void
}) {
  const [code, setCode] = useState(existing?.code ?? '')
  const [name, setName] = useState(existing?.name ?? '')
  const [ratePct, setRatePct] = useState(
    existing ? (existing.rate * 100).toString() : ''
  )
  const [appliesTo, setAppliesTo] = useState(existing?.appliesTo ?? 'domestic')
  const [notes, setNotes] = useState<string | null>(existing?.notes ?? '')
  const [xeroTaxType, setXeroTaxType] = useState(existing?.xeroTaxType ?? '')
  const [isDefault, setIsDefault] = useState(existing?.isDefault ?? false)
  const [saving, setSaving] = useState(false)

  async function save() {
    const rate = Number.parseFloat(ratePct) / 100
    if (!code.trim() || !name.trim() || !Number.isFinite(rate) || rate < 0 || rate > 1) {
      toast.error('Code, name and a rate between 0–100 % are required.')
      return
    }
    setSaving(true)
    try {
      const url = existing
        ? `/api/admin/billing/tax-rates/${existing.id}`
        : '/api/admin/billing/tax-rates'
      const method = existing ? 'PATCH' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          code: code.trim(),
          name: name.trim(),
          rate,
          appliesTo: appliesTo.trim() || 'domestic',
          notes: notes?.trim() || null,
          xeroTaxType: xeroTaxType.trim() || null,
          isDefault,
        }),
      })
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as {
          error?: string
        } | null
        throw new Error(json?.error ?? `HTTP ${res.status}`)
      }
      toast.success(existing ? 'Tax rate updated' : 'Tax rate created')
      onSaved()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {existing ? 'Edit tax rate' : 'New tax rate'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="tax-code" className="text-xs">
                Code
              </Label>
              <Input
                id="tax-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="VAT_STD"
                className="h-9 text-sm"
              />
            </div>
            <div>
              <Label htmlFor="tax-rate-pct" className="text-xs">
                Rate (%)
              </Label>
              <Input
                id="tax-rate-pct"
                type="number"
                min="0"
                max="100"
                step="0.01"
                value={ratePct}
                onChange={(e) => setRatePct(e.target.value)}
                placeholder="20"
                className="h-9 text-sm"
              />
            </div>
          </div>
          <div>
            <Label htmlFor="tax-name" className="text-xs">
              Name
            </Label>
            <Input
              id="tax-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="UK VAT (standard rate)"
              className="h-9 text-sm"
            />
          </div>
          <div>
            <Label htmlFor="tax-applies" className="text-xs">
              Applies to
            </Label>
            <Input
              id="tax-applies"
              value={appliesTo}
              onChange={(e) => setAppliesTo(e.target.value)}
              placeholder="domestic"
              className="h-9 text-sm"
            />
          </div>
          <div>
            <Label htmlFor="tax-notes" className="text-xs">
              Notes (optional)
            </Label>
            <Input
              id="tax-notes"
              value={notes ?? ''}
              onChange={(e) => setNotes(e.target.value)}
              className="h-9 text-sm"
            />
          </div>
          <div>
            <Label htmlFor="tax-xero" className="text-xs">
              Xero TaxType (only if Xero provider active)
            </Label>
            <Input
              id="tax-xero"
              value={xeroTaxType}
              onChange={(e) => setXeroTaxType(e.target.value)}
              placeholder="OUTPUT2"
              className="h-9 font-mono text-sm"
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              Maps this rate onto Xero&rsquo;s per-org tax library. Find the
              codes in Xero: Settings → Tax rates. Leave blank to send line
              items as <span className="font-mono">NONE</span>.
            </p>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isDefault}
              onChange={(e) => setIsDefault(e.target.checked)}
              className="h-4 w-4 rounded border-border accent-primary"
            />
            <span>Mark as default rate</span>
          </label>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="ghost" disabled={saving}>
              Cancel
            </Button>
          </DialogClose>
          <Button type="button" onClick={save} disabled={saving}>
            {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
