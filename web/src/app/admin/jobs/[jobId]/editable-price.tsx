'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Loader2, Pencil, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

type PricingField =
  | 'quotedPrice'
  | 'finalPrice'
  | 'clerkPayout'
  | 'clerkBonus'
  | 'clerkFinalPayout'

type Props = {
  jobId: string
  field: PricingField
  /** Current value as a numeric string (Drizzle `numeric` round-trips as string) or null. */
  value: string | null
}

/**
 * Inline editable price field on the admin job detail (S6c). Replaces the
 * Lovable [`EditablePrice`](../../../../../src/components/admin/EditablePrice.tsx)
 * component. Save path goes through [POST /api/admin/jobs/[id]/pricing-override](
 * ../../api/admin/jobs/[jobId]/pricing-override/route.ts) which writes the
 * `pricing_override/pricing.override.<field>` audit row in the same tx as
 * the UPDATE — closes the F5 audit gap that the Lovable surface left open.
 */
export function EditablePrice({ jobId, field, value }: Props) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [draft, setDraft] = useState(formatForInput(value))

  function startEdit() {
    setDraft(formatForInput(value))
    setEditing(true)
  }

  function cancel() {
    setDraft(formatForInput(value))
    setEditing(false)
  }

  async function save() {
    if (saving) return
    const next = Number.parseFloat(draft)
    if (!Number.isFinite(next) || next < 0) {
      toast.error('Enter a non-negative number')
      return
    }
    if (value !== null && Number(value) === next) {
      // No-op — exit edit mode without a roundtrip.
      setEditing(false)
      return
    }
    setSaving(true)
    try {
      const res = await fetch(`/api/admin/jobs/${jobId}/pricing-override`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: next }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error ?? `HTTP ${res.status}`)
      }
      toast.success('Saved')
      setEditing(false)
      router.refresh()
    } catch (err) {
      toast.error('Could not save', {
        description: err instanceof Error ? err.message : 'Please try again.',
      })
    } finally {
      setSaving(false)
    }
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={startEdit}
        className="inline-flex items-center gap-1 text-sm font-medium hover:text-primary"
      >
        {value !== null && value !== undefined
          ? `£${Number(value).toFixed(2)}`
          : '—'}
        <Pencil className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" />
      </button>
    )
  }

  return (
    <span className="inline-flex items-center gap-1">
      <Input
        type="number"
        step="0.01"
        min="0"
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void save()
          if (e.key === 'Escape') cancel()
        }}
        disabled={saving}
        className="h-7 w-24 text-xs"
      />
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={save}
        disabled={saving}
        className="h-7 w-7 p-0"
      >
        {saving ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Check className="h-3.5 w-3.5" />
        )}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={cancel}
        disabled={saving}
        className="h-7 w-7 p-0"
      >
        <X className="h-3.5 w-3.5" />
      </Button>
    </span>
  )
}

function formatForInput(value: string | null): string {
  if (value === null || value === undefined) return '0'
  const n = Number(value)
  return Number.isFinite(n) ? n.toFixed(2) : '0'
}
