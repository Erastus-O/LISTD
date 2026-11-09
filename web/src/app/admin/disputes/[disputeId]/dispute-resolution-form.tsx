'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

const STATUS_OPTIONS = [
  { value: 'under_review', label: 'Under review' },
  { value: 'resolved', label: 'Resolve' },
  { value: 'escalated', label: 'Escalate to super-admin' },
] as const

type Props = {
  disputeId: string
  currentStatus: string
  initialAdminNotes: string | null
  initialResolution: string | null
  /** When set, an "Issue strike" button calls the existing clerk strike
   *  handler against this user (the dispute target — usually the clerk). */
  strikeTarget?: { userId: string; fullName: string | null } | null
}

/**
 * Admin dispute resolution form (S6d-2). Three transitions are user-driven:
 *   - Move to under_review (no notification fired)
 *   - Resolve (resolution narrative required; both parties notified)
 *   - Escalate (both parties notified)
 *
 * Strike issuance during resolution lives behind a separate button that
 * calls the existing [`/api/admin/clerks/[id]/strike`](../../../api/admin/clerks/[clerkId]/strike/route.ts)
 * handler — keeps the strike audit row independent of the dispute resolution.
 */
export function DisputeResolutionForm({
  disputeId,
  currentStatus,
  initialAdminNotes,
  initialResolution,
  strikeTarget,
}: Props) {
  const router = useRouter()
  const [status, setStatus] = useState<string>('')
  const [resolution, setResolution] = useState(initialResolution ?? '')
  const [adminNotes, setAdminNotes] = useState(initialAdminNotes ?? '')
  const [submitting, setSubmitting] = useState(false)

  const [showStrike, setShowStrike] = useState(false)
  const [strikeReason, setStrikeReason] = useState('')
  const [strikeSeverity, setStrikeSeverity] = useState('1')
  const [issuingStrike, setIssuingStrike] = useState(false)

  const isResolved = currentStatus === 'resolved'

  async function handleSubmit() {
    if (!status || submitting) return
    if (status === 'resolved' && !resolution.trim()) {
      toast.error('Resolution narrative required')
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch(
        `/api/admin/disputes/${disputeId}/resolve`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            status,
            resolution: resolution.trim() || undefined,
            adminNotes: adminNotes.trim() || undefined,
          }),
        }
      )
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error ?? `HTTP ${res.status}`)
      }
      toast.success(
        status === 'resolved'
          ? 'Dispute resolved'
          : status === 'escalated'
            ? 'Dispute escalated'
            : 'Dispute updated'
      )
      router.refresh()
    } catch (err) {
      toast.error('Could not update dispute', {
        description: err instanceof Error ? err.message : 'Please try again.',
      })
    } finally {
      setSubmitting(false)
    }
  }

  async function handleIssueStrike() {
    if (!strikeTarget || !strikeReason.trim() || issuingStrike) return
    setIssuingStrike(true)
    try {
      const res = await fetch(
        `/api/admin/clerks/${strikeTarget.userId}/strike`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            severity: Number.parseInt(strikeSeverity, 10),
            reason: strikeReason.trim(),
          }),
        }
      )
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error ?? `HTTP ${res.status}`)
      }
      toast.success(
        `Strike issued to ${strikeTarget.fullName ?? 'clerk'}`
      )
      setStrikeReason('')
      setStrikeSeverity('1')
      setShowStrike(false)
      router.refresh()
    } catch (err) {
      toast.error('Could not issue strike', {
        description: err instanceof Error ? err.message : 'Please try again.',
      })
    } finally {
      setIssuingStrike(false)
    }
  }

  return (
    <Card>
      <CardContent className="space-y-4 p-6">
        <h2 className="text-sm font-semibold">
          {isResolved ? 'Update resolution' : 'Resolve dispute'}
        </h2>

        <div className="space-y-1.5">
          <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Action
          </Label>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="h-9 text-xs">
              <SelectValue placeholder="Select an action…" />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Resolution narrative {status === 'resolved' && <span className="text-destructive">*</span>}
          </Label>
          <Textarea
            value={resolution}
            onChange={(e) => setResolution(e.target.value)}
            placeholder="Explain the outcome (visible to client + clerk on resolve / escalate)…"
            rows={3}
            className="text-xs"
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Admin notes (internal)
          </Label>
          <Textarea
            value={adminNotes}
            onChange={(e) => setAdminNotes(e.target.value)}
            placeholder="Internal notes: not shared with parties."
            rows={2}
            className="text-xs"
          />
        </div>

        <Button
          type="button"
          onClick={handleSubmit}
          disabled={!status || submitting}
          className="w-full gap-1"
        >
          {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Apply
        </Button>

        {strikeTarget && (
          <div className="space-y-2 border-t border-border pt-4">
            {!showStrike ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowStrike(true)}
                className="w-full justify-start gap-1.5 border-destructive/30 text-destructive hover:bg-destructive/5"
              >
                <AlertTriangle className="h-3.5 w-3.5" />
                Issue strike to {strikeTarget.fullName ?? 'clerk'}
              </Button>
            ) : (
              <div className="space-y-3 rounded-md border border-destructive/30 bg-destructive/5 p-3">
                <Label className="text-[11px] uppercase tracking-wide text-destructive">
                  Issue strike to {strikeTarget.fullName ?? 'clerk'}
                </Label>
                <Select
                  value={strikeSeverity}
                  onValueChange={setStrikeSeverity}
                >
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">1 : Warning</SelectItem>
                    <SelectItem value="2">2 : Serious</SelectItem>
                    <SelectItem value="3">3 : Severe</SelectItem>
                  </SelectContent>
                </Select>
                <Textarea
                  value={strikeReason}
                  onChange={(e) => setStrikeReason(e.target.value)}
                  placeholder="Reason for strike (visible to clerk)…"
                  rows={2}
                  className="text-xs"
                  disabled={issuingStrike}
                />
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setShowStrike(false)
                      setStrikeReason('')
                    }}
                    disabled={issuingStrike}
                    className="flex-1 text-xs"
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleIssueStrike}
                    disabled={!strikeReason.trim() || issuingStrike}
                    className="flex-1 gap-1 bg-destructive text-destructive-foreground hover:bg-destructive/90 text-xs"
                  >
                    {issuingStrike && (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    )}
                    Issue
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
