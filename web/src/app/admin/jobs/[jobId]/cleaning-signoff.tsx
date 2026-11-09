'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, Loader2, Undo2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

/**
 * Admin sign-off actions for a completed clean awaiting review. Approve →
 * releases the cleaner's escrow payout + issues the client receipt; Return →
 * bounces it back to the cleaner with a note. POSTs to
 * [/api/admin/cleaning/[jobId]/decision](../../../api/admin/cleaning/[jobId]/decision/route.ts).
 */
export function CleaningSignoffActions({ jobId }: { jobId: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState<null | 'approve' | 'return'>(null)
  const [returning, setReturning] = useState(false)
  const [notes, setNotes] = useState('')

  async function send(decision: 'approve' | 'return') {
    if (busy) return
    if (decision === 'return' && notes.trim().length === 0) {
      toast.error('Add a note', {
        description: 'Tell the cleaner what needs fixing.',
      })
      return
    }
    setBusy(decision)
    try {
      const res = await fetch(`/api/admin/cleaning/${jobId}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decision,
          ...(decision === 'return' ? { notes: notes.trim() } : {}),
        }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`)
      toast.success(
        decision === 'approve'
          ? 'Clean approved — payout released'
          : 'Clean returned to the cleaner'
      )
      router.refresh()
    } catch (err) {
      toast.error('Could not submit decision', {
        description: err instanceof Error ? err.message : 'Please try again.',
      })
      setBusy(null)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          onClick={() => send('approve')}
          disabled={busy !== null}
          className="gap-1.5"
        >
          {busy === 'approve' ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <CheckCircle2 className="h-3.5 w-3.5" />
          )}
          Approve &amp; pay cleaner
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setReturning((v) => !v)}
          disabled={busy !== null}
          className="gap-1.5"
        >
          <Undo2 className="h-3.5 w-3.5" />
          Return for amends
        </Button>
      </div>
      {returning && (
        <div className="space-y-2">
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="What needs fixing? (sent to the cleaner)"
            rows={3}
            maxLength={2000}
          />
          <Button
            size="sm"
            variant="secondary"
            onClick={() => send('return')}
            disabled={busy !== null}
            className="gap-1.5"
          >
            {busy === 'return' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : null}
            Send back to cleaner
          </Button>
        </div>
      )}
    </div>
  )
}
