'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Calculator, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'

/**
 * Admin-only backfill trigger. POSTs to
 * `/api/admin/jobs/recompute-payouts`, which recomputes clerk pay for any
 * job still sitting at £0 (legacy rows from before payout computation
 * existed) and skips locked / finalised jobs. Safe to re-run.
 */
export function RecomputePayoutsButton() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function run() {
    if (busy) return
    setBusy(true)
    try {
      const res = await fetch('/api/admin/jobs/recompute-payouts', {
        method: 'POST',
      })
      const json = (await res.json().catch(() => null)) as {
        updated?: number
        skipped?: number
        error?: string
      } | null
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`)
      toast.success('Clerk pay recomputed', {
        description: `${json?.updated ?? 0} job(s) updated${
          json?.skipped ? `, ${json.skipped} skipped` : ''
        }.`,
      })
      router.refresh()
    } catch (err) {
      toast.error('Recompute failed', {
        description: err instanceof Error ? err.message : 'Please try again.',
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={run}
      disabled={busy}
      className="gap-1.5"
      title="Recompute clerk pay for jobs still at £0 (legacy rows)"
    >
      {busy ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Calculator className="h-3.5 w-3.5" />
      )}
      Recompute £0 pay
    </Button>
  )
}
