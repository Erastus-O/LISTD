'use client'

import { useState } from 'react'
import { Check, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { formatSlot } from '@/lib/scheduling/slots'

/**
 * Tenant slot picker — multi-select 30-minute slots within the job's timeframe,
 * saved to /api/tenant/slots with the portal token.
 */
export function SlotPicker({
  token,
  slots,
  initial,
}: {
  token: string
  slots: string[]
  initial: string[]
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set(initial))
  const [saving, setSaving] = useState(false)
  const [savedCount, setSavedCount] = useState<number | null>(
    initial.length > 0 ? initial.length : null
  )

  function toggle(slot: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(slot)) next.delete(slot)
      else next.add(slot)
      return next
    })
  }

  async function save() {
    if (saving) return
    setSaving(true)
    try {
      const res = await fetch('/api/tenant/slots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, slots: Array.from(selected) }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`)
      const saved: string[] = data?.slots ?? []
      setSelected(new Set(saved))
      setSavedCount(saved.length)
      toast.success(
        saved.length > 0
          ? `Saved ${saved.length} slot${saved.length === 1 ? '' : 's'}`
          : 'Cleared your slots'
      )
    } catch (err) {
      toast.error('Could not save your slots', {
        description: err instanceof Error ? err.message : 'Please try again.',
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {slots.map((slot) => {
          const on = selected.has(slot)
          return (
            <button
              key={slot}
              type="button"
              onClick={() => toggle(slot)}
              className={`flex items-center justify-center gap-1.5 rounded-lg border-2 px-2 py-2.5 text-sm transition-all ${
                on
                  ? 'border-primary bg-primary/10 font-medium text-foreground'
                  : 'border-border bg-background text-muted-foreground hover:border-primary/40'
              }`}
            >
              {on && <Check className="h-3.5 w-3.5 text-primary" />}
              {formatSlot(slot)}
            </button>
          )
        })}
      </div>

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {selected.size} slot{selected.size === 1 ? '' : 's'} selected
          {savedCount !== null && ` · ${savedCount} saved`}
        </p>
        <Button onClick={save} disabled={saving} className="gap-1.5">
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Check className="h-4 w-4" />
          )}
          Save my availability
        </Button>
      </div>
    </div>
  )
}
