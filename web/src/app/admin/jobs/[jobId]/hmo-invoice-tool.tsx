'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Receipt } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { computeHmoCleaningSplit } from '@/lib/cleaning/hmo-invoicing'

/**
 * Admin tool: generate separate draft invoices per numbered bedroom + communal
 * for an HMO cleaning job. Pre-fills an even split of the client price; the
 * admin sets the bedroom count and generates. Drafts are editable afterwards.
 */
export function HmoInvoiceTool({
  jobId,
  total,
  defaultBedrooms,
}: {
  jobId: string
  total: number
  defaultBedrooms: number
}) {
  const router = useRouter()
  const [bedrooms, setBedrooms] = useState(Math.max(0, defaultBedrooms))
  const [pending, setPending] = useState(false)

  const split = useMemo(
    () => computeHmoCleaningSplit(total, bedrooms),
    [total, bedrooms]
  )

  async function generate() {
    if (pending) return
    setPending(true)
    try {
      const res = await fetch(`/api/admin/jobs/${jobId}/hmo-invoices`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bedrooms }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`)
      toast.success(`Created ${data?.count ?? split.length} draft invoices`, {
        description: 'One per bedroom + communal. Review and issue them.',
      })
      router.refresh()
    } catch (err) {
      toast.error('Could not generate invoices', {
        description: err instanceof Error ? err.message : 'Please try again.',
      })
      setPending(false)
    }
  }

  return (
    <div className="space-y-2 rounded-md border border-dashed border-border p-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        HMO per-bedroom invoicing
      </p>
      <p className="text-xs text-muted-foreground">
        Split the £{total.toFixed(2)} client price into separate draft invoices :
        one per numbered bedroom + communal areas.
      </p>
      <label className="flex items-center gap-2 text-xs">
        <span className="text-muted-foreground">Bedrooms to invoice</span>
        <input
          type="number"
          min={0}
          max={30}
          value={bedrooms}
          onChange={(e) => {
            const n = Number(e.target.value)
            setBedrooms(Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0)
          }}
          className="w-16 rounded-md border border-input bg-background px-1.5 py-1 text-right font-mono text-xs focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </label>
      {split.length > 0 && (
        <ul className="space-y-0.5 text-[11px] text-muted-foreground">
          {split.map((l, i) => (
            <li key={i} className="flex justify-between">
              <span>{l.label}</span>
              <span className="font-mono">£{l.amount.toFixed(2)}</span>
            </li>
          ))}
        </ul>
      )}
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={generate}
        disabled={pending || split.length === 0}
        className="gap-1.5"
      >
        {pending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Receipt className="h-3.5 w-3.5" />
        )}
        Generate {split.length} draft invoices
      </Button>
    </div>
  )
}
