'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

type Props = {
  jobId: string
}

/**
 * Client cancel-job button. Two-step inline confirm with optional reason.
 * Posts to [/api/client/jobs/[id]/cancel](../../../../api/client/jobs/[jobId]/cancel/route.ts)
 * which enforces ownership + status (`draft` / `pending` / `published`)
 * and writes the `job_lifecycle/job.cancelled` audit row.
 *
 * The dedicated client handler exists rather than reusing the admin route
 * because it scopes to ownership server-side and intentionally doesn't
 * accept a cancellation fee — once a clerk has accepted, fee logic moves
 * through the admin / dispute flow.
 */
export function CancelJobButton({ jobId }: Props) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [reason, setReason] = useState('')
  const [pending, setPending] = useState(false)

  async function handleCancel() {
    if (pending) return
    setPending(true)
    try {
      const res = await fetch(`/api/client/jobs/${jobId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim() || undefined }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error ?? `HTTP ${res.status}`)
      }
      toast.success('Job cancelled')
      router.refresh()
    } catch (err) {
      toast.error('Could not cancel job', {
        description: err instanceof Error ? err.message : 'Please try again.',
      })
      setPending(false)
    }
  }

  if (!confirming) {
    return (
      <Button
        type="button"
        variant="destructive"
        size="sm"
        onClick={() => setConfirming(true)}
        className="gap-1.5"
      >
        <XCircle className="h-3.5 w-3.5" />
        Cancel Job
      </Button>
    )
  }

  return (
    <div className="space-y-2 rounded-md border border-destructive/30 bg-destructive/5 p-3">
      <Label className="text-[11px] uppercase tracking-wide text-destructive">
        Cancel this job
      </Label>
      <p className="text-[10px] leading-relaxed text-muted-foreground">
        The assigned clerk (if any) is notified. The audit log records the
        reason. This action cannot be undone.
      </p>
      <Textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason (optional)…"
        rows={2}
        disabled={pending}
        className="text-xs"
      />
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => {
            setConfirming(false)
            setReason('')
          }}
          disabled={pending}
          className="flex-1 text-xs"
        >
          Keep Job
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={handleCancel}
          disabled={pending}
          className="flex-1 gap-1 bg-destructive text-destructive-foreground hover:bg-destructive/90 text-xs"
        >
          {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Yes, Cancel
        </Button>
      </div>
    </div>
  )
}
