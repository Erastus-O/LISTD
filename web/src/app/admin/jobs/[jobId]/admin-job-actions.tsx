'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Scale,
  Shield,
  Trash2,
  UserCog,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import type { VerifiedClerkOption } from '@/lib/dashboard/admin-jobs'

const STATUSES = [
  { value: 'draft', label: 'Draft' },
  { value: 'pending', label: 'Pending' },
  { value: 'published', label: 'Published' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'assigned', label: 'Assigned' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'reviewed', label: 'Reviewed' },
  { value: 'signed', label: 'Signed' },
  { value: 'completed', label: 'Completed' },
  { value: 'paid', label: 'Paid' },
  { value: 'cancelled', label: 'Cancelled' },
] as const

type Props = {
  jobId: string
  /** Human-readable LST-YYYY-NNNN ref. Required for the Delete typed-confirm. */
  jobRef: string
  currentStatus: string
  currentClerkId: string | null
  /** Used as the default `raisedAgainst` target on the Raise Dispute form when
   *  no clerk is yet assigned (dispute is then against the client). */
  clientId: string | null
  clerks: VerifiedClerkOption[]
  /** YYYY-MM-DD — seed for the schedule editor. */
  currentScheduledDate: string
  /** UK wall-clock "HH:MM" of the confirmed arrival time, or null. */
  currentArrivalTime: string | null
}

/**
 * Admin lifecycle action panel on the job detail (S6c-2). Each action posts
 * to a dedicated handler that writes the matching audit row in the same tx
 * as the mutation. Partial failure cannot produce a state change without the
 * forensic record.
 *
 * As of the Lovable parity port (2026-05): Delete Job and Raise Dispute are
 * wired alongside Assign / Status override / Cancel / Mark-completed.
 */
export function AdminJobActions({
  jobId,
  jobRef,
  currentStatus,
  currentClerkId,
  clientId,
  clerks,
  currentScheduledDate,
  currentArrivalTime,
}: Props) {
  const router = useRouter()

  // Each action keeps its own loading + form state; we don't multiplex
  // because the actions are independent and a single global flag would
  // disable cancellable forms during long requests.
  const [assignTarget, setAssignTarget] = useState<string>('')
  const [assigning, setAssigning] = useState(false)

  const [statusTarget, setStatusTarget] = useState<string>('')
  const [statusReason, setStatusReason] = useState('')
  const [showStatusForm, setShowStatusForm] = useState(false)
  const [overriding, setOverriding] = useState(false)

  const [showCancelForm, setShowCancelForm] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const [cancelling, setCancelling] = useState(false)

  const [completing, setCompleting] = useState(false)

  const [showDisputeForm, setShowDisputeForm] = useState(false)
  const [disputeAgainst, setDisputeAgainst] = useState<string>(
    currentClerkId ?? clientId ?? ''
  )
  const [disputeReason, setDisputeReason] = useState('')
  const [disputeDescription, setDisputeDescription] = useState('')
  const [raising, setRaising] = useState(false)

  const [showDeleteForm, setShowDeleteForm] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState('')
  const [deleting, setDeleting] = useState(false)

  const [showScheduleForm, setShowScheduleForm] = useState(false)
  const [schedDate, setSchedDate] = useState(currentScheduledDate)
  const [schedTime, setSchedTime] = useState(currentArrivalTime ?? '')
  const [scheduling, setScheduling] = useState(false)

  const isTerminal =
    currentStatus === 'completed' ||
    currentStatus === 'paid' ||
    currentStatus === 'cancelled'

  async function callJson(url: string, body: object) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const out = await res.json().catch(() => null)
      throw new Error(out?.error ?? `HTTP ${res.status}`)
    }
    return res.json()
  }

  async function handleSchedule() {
    if (scheduling) return
    setScheduling(true)
    try {
      await callJson(`/api/admin/jobs/${jobId}/schedule`, {
        date: schedDate,
        time: schedTime || null,
      })
      toast.success('Schedule updated', {
        description: schedTime
          ? `Set to ${schedDate} at ${schedTime}. Reminders and the missed check-in alarm are armed.`
          : `Date set to ${schedDate}; exact time cleared.`,
      })
      setShowScheduleForm(false)
      router.refresh()
    } catch (err) {
      toast.error('Could not update schedule', {
        description: err instanceof Error ? err.message : 'Please try again.',
      })
    } finally {
      setScheduling(false)
    }
  }

  async function handleAssign() {
    if (!assignTarget || assigning) return
    if (assignTarget === currentClerkId) {
      toast.message('Already assigned to this clerk')
      return
    }
    setAssigning(true)
    try {
      await callJson(`/api/admin/jobs/${jobId}/assign-clerk`, {
        clerkId: assignTarget,
      })
      toast.success('Clerk assigned')
      setAssignTarget('')
      router.refresh()
    } catch (err) {
      toast.error('Could not assign clerk', {
        description: err instanceof Error ? err.message : 'Please try again.',
      })
    } finally {
      setAssigning(false)
    }
  }

  async function handleStatusOverride() {
    if (!statusTarget || overriding) return
    if (statusTarget === currentStatus) {
      toast.message('Job is already at this status')
      return
    }
    setOverriding(true)
    try {
      await callJson(`/api/admin/jobs/${jobId}/status`, {
        status: statusTarget,
        reason: statusReason.trim() || undefined,
      })
      toast.success(`Status set to ${statusTarget.replace(/_/g, ' ')}`)
      setStatusTarget('')
      setStatusReason('')
      setShowStatusForm(false)
      router.refresh()
    } catch (err) {
      toast.error('Could not override status', {
        description: err instanceof Error ? err.message : 'Please try again.',
      })
    } finally {
      setOverriding(false)
    }
  }

  async function handleCancel() {
    if (cancelling) return
    setCancelling(true)
    try {
      await callJson(`/api/admin/jobs/${jobId}/cancel`, {
        reason: cancelReason.trim() || undefined,
      })
      toast.success('Job cancelled')
      setCancelReason('')
      setShowCancelForm(false)
      router.refresh()
    } catch (err) {
      toast.error('Could not cancel', {
        description: err instanceof Error ? err.message : 'Please try again.',
      })
    } finally {
      setCancelling(false)
    }
  }

  async function handleRaiseDispute() {
    if (raising) return
    if (!disputeAgainst) {
      toast.error('Choose who the dispute is against')
      return
    }
    if (!disputeReason.trim()) {
      toast.error('Reason is required')
      return
    }
    setRaising(true)
    try {
      await callJson(`/api/admin/jobs/${jobId}/raise-dispute`, {
        raisedAgainst: disputeAgainst,
        reason: disputeReason.trim(),
        description: disputeDescription.trim() || undefined,
      })
      toast.success('Dispute opened')
      setDisputeReason('')
      setDisputeDescription('')
      setShowDisputeForm(false)
      router.refresh()
    } catch (err) {
      toast.error('Could not open dispute', {
        description: err instanceof Error ? err.message : 'Please try again.',
      })
    } finally {
      setRaising(false)
    }
  }

  async function handleDelete() {
    if (deleting) return
    if (deleteConfirm.trim() !== jobRef) {
      toast.error(`Type "${jobRef}" exactly to confirm permanent deletion`)
      return
    }
    setDeleting(true)
    try {
      await callJson(`/api/admin/jobs/${jobId}/delete`, {
        confirmRef: deleteConfirm.trim(),
      })
      toast.success('Job deleted')
      router.push('/admin/jobs')
      router.refresh()
    } catch (err) {
      toast.error('Could not delete job', {
        description: err instanceof Error ? err.message : 'Please try again.',
      })
      setDeleting(false)
    }
  }

  async function handleMarkCompleted() {
    if (completing) return
    setCompleting(true)
    try {
      await callJson(`/api/admin/jobs/${jobId}/mark-completed`, {})
      toast.success('Job marked completed')
      router.refresh()
    } catch (err) {
      toast.error('Could not mark completed', {
        description: err instanceof Error ? err.message : 'Please try again.',
      })
    } finally {
      setCompleting(false)
    }
  }

  return (
    <Card>
      <CardContent className="space-y-4 p-6">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
          <Shield className="h-4 w-4" />
          Admin actions
        </h2>

        {/* Assign clerk */}
        <div className="space-y-1.5">
          <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Assign clerk
          </Label>
          <div className="flex gap-2">
            <Select value={assignTarget} onValueChange={setAssignTarget}>
              <SelectTrigger className="h-9 flex-1 text-xs">
                <SelectValue placeholder="Select a verified clerk…" />
              </SelectTrigger>
              <SelectContent>
                {clerks.length === 0 ? (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">
                    No verified clerks
                  </div>
                ) : (
                  clerks.map((c) => (
                    <SelectItem key={c.userId} value={c.userId}>
                      {c.fullName ?? '(no name)'} · L{c.clerkLevel ?? 1}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
            <Button
              type="button"
              size="sm"
              onClick={handleAssign}
              disabled={!assignTarget || assigning}
              className="gap-1"
            >
              {assigning ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <UserCog className="h-3.5 w-3.5" />
              )}
              Assign
            </Button>
          </div>
        </div>

        {/* Schedule (date + exact arrival time) */}
        {!showScheduleForm ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setShowScheduleForm(true)}
            className="w-full justify-start"
          >
            {currentArrivalTime
              ? `Edit schedule (${currentArrivalTime})`
              : 'Set exact arrival time'}
          </Button>
        ) : (
          <div className="space-y-2 rounded-md border border-border bg-muted/20 p-3">
            <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Schedule
            </Label>
            <div className="flex gap-2">
              <Input
                type="date"
                value={schedDate}
                onChange={(e) => setSchedDate(e.target.value)}
                className="h-9 flex-1 text-xs"
              />
              <Input
                type="time"
                value={schedTime}
                onChange={(e) => setSchedTime(e.target.value)}
                className="h-9 w-28 text-xs"
              />
            </div>
            <p className="text-[11px] text-muted-foreground">
              UK time. The exact time arms the 2-hour reminder and the
              missed check-in alarm; leave it blank to clear.
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setShowScheduleForm(false)
                  setSchedDate(currentScheduledDate)
                  setSchedTime(currentArrivalTime ?? '')
                }}
                disabled={scheduling}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={handleSchedule}
                disabled={!schedDate || scheduling}
                className="flex-1 gap-1"
              >
                {scheduling && (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                )}
                Apply
              </Button>
            </div>
          </div>
        )}

        {/* Status override */}
        {!showStatusForm ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setShowStatusForm(true)}
            className="w-full justify-start"
          >
            Override status
          </Button>
        ) : (
          <div className="space-y-2 rounded-md border border-border bg-muted/20 p-3">
            <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Override status
            </Label>
            <Select value={statusTarget} onValueChange={setStatusTarget}>
              <SelectTrigger className="h-9 text-xs">
                <SelectValue placeholder="Select status…" />
              </SelectTrigger>
              <SelectContent>
                {STATUSES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Textarea
              value={statusReason}
              onChange={(e) => setStatusReason(e.target.value)}
              placeholder="Reason (optional, captured in audit log)…"
              rows={2}
              className="text-xs"
            />
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setShowStatusForm(false)
                  setStatusTarget('')
                  setStatusReason('')
                }}
                disabled={overriding}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={handleStatusOverride}
                disabled={!statusTarget || overriding}
                className="flex-1 gap-1"
              >
                {overriding && (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                )}
                Apply
              </Button>
            </div>
          </div>
        )}

        {/* Mark completed (only when not already terminal) */}
        {!isTerminal && (
          <Button
            type="button"
            size="sm"
            onClick={handleMarkCompleted}
            disabled={completing}
            className="w-full justify-start gap-1.5 bg-emerald-600 text-white hover:bg-emerald-600/90"
          >
            {completing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <CheckCircle2 className="h-3.5 w-3.5" />
            )}
            Mark as completed
          </Button>
        )}

        {/* Raise dispute (skipped on cancelled/deleted) */}
        {currentStatus !== 'cancelled' && (
          <>
            {!showDisputeForm ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setShowDisputeForm(true)}
                className="w-full justify-start gap-1.5"
              >
                <Scale className="h-3.5 w-3.5" />
                Raise dispute
              </Button>
            ) : (
              <div className="space-y-2 rounded-md border border-border bg-muted/20 p-3">
                <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Raise dispute
                </Label>
                <p className="text-[10px] leading-relaxed text-muted-foreground">
                  Opens a dispute row visible to both parties; written to the
                  audit log as <code>dispute/dispute.opened</code>.
                </p>
                <Select
                  value={disputeAgainst}
                  onValueChange={setDisputeAgainst}
                >
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue placeholder="Against…" />
                  </SelectTrigger>
                  <SelectContent>
                    {clientId && (
                      <SelectItem value={clientId}>Client</SelectItem>
                    )}
                    {currentClerkId && (
                      <SelectItem value={currentClerkId}>
                        Assigned clerk
                      </SelectItem>
                    )}
                  </SelectContent>
                </Select>
                <Input
                  value={disputeReason}
                  onChange={(e) => setDisputeReason(e.target.value)}
                  placeholder="Reason (short)"
                  className="h-9 text-xs"
                />
                <Textarea
                  value={disputeDescription}
                  onChange={(e) => setDisputeDescription(e.target.value)}
                  placeholder="Description (optional)"
                  rows={3}
                  className="text-xs"
                />
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setShowDisputeForm(false)
                      setDisputeReason('')
                      setDisputeDescription('')
                    }}
                    disabled={raising}
                    className="flex-1"
                  >
                    Back
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleRaiseDispute}
                    disabled={raising || !disputeAgainst}
                    className="flex-1 gap-1"
                  >
                    {raising && (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    )}
                    Open dispute
                  </Button>
                </div>
              </div>
            )}
          </>
        )}

        {/* Cancel (only when not already cancelled) */}
        {currentStatus !== 'cancelled' && (
          <>
            {!showCancelForm ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setShowCancelForm(true)}
                className="w-full justify-start gap-1.5 border-destructive/30 text-destructive hover:bg-destructive/5"
              >
                <AlertTriangle className="h-3.5 w-3.5" />
                Cancel job
              </Button>
            ) : (
              <div className="space-y-2 rounded-md border border-destructive/30 bg-destructive/5 p-3">
                <Label className="text-[11px] uppercase tracking-wide text-destructive">
                  Cancel job
                </Label>
                <p className="text-[10px] leading-relaxed text-muted-foreground">
                  Client and assigned clerk are notified. Audit row records
                  the prior status + reason.
                </p>
                <Textarea
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  placeholder="Reason (optional)…"
                  rows={2}
                  className="text-xs"
                />
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setShowCancelForm(false)
                      setCancelReason('')
                    }}
                    disabled={cancelling}
                    className="flex-1"
                  >
                    Back
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleCancel}
                    disabled={cancelling}
                    className="flex-1 gap-1 bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    {cancelling && (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    )}
                    Cancel job
                  </Button>
                </div>
              </div>
            )}
          </>
        )}

        {/* Delete permanently — guarded by typed-ref confirm */}
        {!showDeleteForm ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setShowDeleteForm(true)}
            className="w-full justify-start gap-1.5 border-destructive/40 bg-destructive/5 text-destructive hover:bg-destructive/10"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete job permanently
          </Button>
        ) : (
          <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/10 p-3">
            <Label className="text-[11px] uppercase tracking-wide text-destructive">
              Delete job permanently
            </Label>
            <p className="text-[10px] leading-relaxed text-muted-foreground">
              Hard-deletes the job and its dependent rows. The audit row
              (<code>job_lifecycle/job.deleted</code>) is preserved so the
              forensic trail survives. Type{' '}
              <code className="rounded bg-background px-1 py-0.5 text-foreground">
                {jobRef}
              </code>{' '}
              to confirm.
            </p>
            <Input
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
              placeholder={jobRef}
              className="h-9 font-mono text-xs"
              disabled={deleting}
            />
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setShowDeleteForm(false)
                  setDeleteConfirm('')
                }}
                disabled={deleting}
                className="flex-1"
              >
                Back
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={handleDelete}
                disabled={deleting || deleteConfirm.trim() !== jobRef}
                className="flex-1 gap-1 bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {deleting && (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                )}
                Delete permanently
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
