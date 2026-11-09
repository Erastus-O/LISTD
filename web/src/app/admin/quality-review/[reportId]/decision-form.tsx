'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, Loader2, RotateCcw, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

const CHECKLIST_ITEMS = [
  { id: 'rooms', label: 'Report covers all expected rooms for the property type' },
  { id: 'photos', label: 'Photos are present and adequate' },
  { id: 'notes', label: 'Condition notes are sufficiently detailed' },
  { id: 'property', label: 'Report is for the correct property' },
  { id: 'clerk', label: 'Clerk details on the report are correct' },
] as const

type Props = {
  reportId: string
  /** When true, the report is no longer in the `submitted` state — the
   *  page renders the form in read-only mode for context. */
  alreadyDecided: boolean
  initialNotes: string | null
}

/**
 * Quality-review decision form (S6d-3). Three transitions, all routed
 * through [POST /api/admin/quality-review/[id]/decision](../../api/admin/quality-review/[reportId]/decision/route.ts):
 *
 *   - **Approve** — gated on the 5-item checklist (parity with Lovable).
 *     Writes `job_lifecycle/job.completed` audit + flips job to `completed`.
 *   - **Return** — narrative required. Writes `job_lifecycle/job.in_progress`
 *     audit (with `reason='returned_for_amends'`) + flips job back.
 *   - **Reject** — narrative required. Writes `job_lifecycle/report.rejected`;
 *     job status untouched (admin decides next move via job-detail override).
 */
export function QualityReviewDecisionForm({
  reportId,
  alreadyDecided,
  initialNotes,
}: Props) {
  const router = useRouter()
  const [checklist, setChecklist] = useState<Record<string, boolean>>({})
  const [notes, setNotes] = useState(initialNotes ?? '')
  const [pending, setPending] = useState<
    null | 'approve' | 'return' | 'reject'
  >(null)

  const allChecked = CHECKLIST_ITEMS.every((i) => checklist[i.id])

  async function decide(decision: 'approve' | 'return' | 'reject') {
    if (pending) return
    if (decision === 'approve' && !allChecked) {
      toast.error('Complete the checklist before approving')
      return
    }
    if (decision !== 'approve' && !notes.trim()) {
      toast.error('Notes are required when returning or rejecting')
      return
    }
    setPending(decision)
    try {
      const res = await fetch(
        `/api/admin/quality-review/${reportId}/decision`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            decision,
            notes: notes.trim() || undefined,
          }),
        }
      )
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error ?? `HTTP ${res.status}`)
      }
      toast.success(
        decision === 'approve'
          ? 'Report approved · job completed'
          : decision === 'return'
            ? 'Report returned to clerk'
            : 'Report rejected'
      )
      router.push('/admin/quality-review')
      router.refresh()
    } catch (err) {
      toast.error('Could not record decision', {
        description: err instanceof Error ? err.message : 'Please try again.',
      })
    } finally {
      setPending(null)
    }
  }

  if (alreadyDecided) {
    return (
      <Card>
        <CardContent className="space-y-2 p-6 text-sm">
          <h2 className="text-sm font-semibold">Decision recorded</h2>
          <p className="text-xs text-muted-foreground">
            This report has already been decided. Use the job detail page to
            override status if a re-review is needed.
          </p>
          {initialNotes && (
            <div className="rounded-md border border-border bg-muted/30 p-3">
              <p className="text-xs text-muted-foreground">Reviewer notes</p>
              <p className="whitespace-pre-line">{initialNotes}</p>
            </div>
          )}
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardContent className="space-y-4 p-6">
        <h2 className="text-sm font-semibold">Reviewer checklist</h2>
        <ul className="space-y-2">
          {CHECKLIST_ITEMS.map((item) => (
            <li key={item.id} className="flex items-start gap-2 text-xs">
              <input
                id={`check-${item.id}`}
                type="checkbox"
                checked={!!checklist[item.id]}
                onChange={(e) =>
                  setChecklist((prev) => ({
                    ...prev,
                    [item.id]: e.target.checked,
                  }))
                }
                className="mt-0.5 h-3.5 w-3.5 cursor-pointer"
              />
              <label
                htmlFor={`check-${item.id}`}
                className="cursor-pointer leading-relaxed"
              >
                {item.label}
              </label>
            </li>
          ))}
        </ul>

        <div className="space-y-1.5">
          <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Reviewer notes
          </Label>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Required for return / reject. Approval saves notes too."
            rows={3}
            className="text-xs"
          />
        </div>

        <div className="space-y-2">
          <Button
            type="button"
            onClick={() => decide('approve')}
            disabled={!allChecked || pending !== null}
            className="w-full justify-start gap-1.5 bg-emerald-600 text-white hover:bg-emerald-600/90"
          >
            {pending === 'approve' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <CheckCircle2 className="h-3.5 w-3.5" />
            )}
            Approve · mark job completed
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => decide('return')}
            disabled={pending !== null || !notes.trim()}
            className="w-full justify-start gap-1.5"
          >
            {pending === 'return' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RotateCcw className="h-3.5 w-3.5" />
            )}
            Return for amends
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => decide('reject')}
            disabled={pending !== null || !notes.trim()}
            className="w-full justify-start gap-1.5 border-destructive/30 text-destructive hover:bg-destructive/5"
          >
            {pending === 'reject' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <XCircle className="h-3.5 w-3.5" />
            )}
            Reject report
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
