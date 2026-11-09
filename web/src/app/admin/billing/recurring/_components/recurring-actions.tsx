'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Pause, Play, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'

/**
 * Inline pause/resume + delete actions on each row of the recurring
 * templates table. Confirmations happen via the browser's `confirm()` —
 * tabular row context doesn't warrant a full dialog.
 */
export function RecurringActions({
  templateId,
  active,
}: {
  templateId: string
  active: boolean
}) {
  const router = useRouter()
  const [pending, setPending] = useState(false)

  async function toggle() {
    if (pending) return
    setPending(true)
    try {
      const res = await fetch(`/api/admin/billing/recurring/${templateId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ active: !active }),
      })
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(json?.error ?? `HTTP ${res.status}`)
      }
      toast.success(active ? 'Template paused' : 'Template resumed')
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Update failed')
    } finally {
      setPending(false)
    }
  }

  async function del() {
    if (pending) return
    if (!window.confirm('Delete this recurring template? Past invoices stay; future fires stop.')) {
      return
    }
    setPending(true)
    try {
      const res = await fetch(`/api/admin/billing/recurring/${templateId}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(json?.error ?? `HTTP ${res.status}`)
      }
      toast.success('Template deleted')
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Delete failed')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex items-center justify-end gap-1">
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={toggle}
        disabled={pending}
        title={active ? 'Pause' : 'Resume'}
      >
        {active ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={del}
        disabled={pending}
        title="Delete"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
      {pending && (
        <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
      )}
    </div>
  )
}
