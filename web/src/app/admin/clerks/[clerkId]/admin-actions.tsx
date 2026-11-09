'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  AlertTriangle,
  Eye,
  KeyRound,
  Loader2,
  RotateCcw,
  Trash2,
  type LucideIcon,
} from 'lucide-react'
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

type AccountStatus = 'active' | 'suspended' | 'deleted'

type Props = {
  clerkId: string
  clerkName: string | null
  /** Current `profiles.account_status` for the clerk — drives which
   *  Suspend/Reactivate button shows. */
  currentStatus: AccountStatus
  /** Roles on the target clerk profile — drives the post-impersonation
   *  destination (clerks → /clerk/dashboard, fallback /post-signin). */
  targetRoles: string[]
}

/**
 * Admin Actions card on the clerk detail page. Layout matches Lovable:
 * Suspend / Delete / Impersonate as the primary actions. The audit-wired
 * Issue Strike button (S6a) sits below in its own section since strikes
 * have their own dedicated audit category and are domain-distinct from
 * account-status transitions.
 *
 * Wires through to:
 *   - [POST /api/admin/clients/[id]/account-status](../../../api/admin/clients/[clientId]/account-status/route.ts)
 *     for Suspend / Reactivate / Delete (the handler is keyed on profile
 *     id, not role, so it works for clerks too).
 *   - [POST /api/admin/impersonation/start](../../../api/admin/impersonation/start/route.ts) for Impersonate.
 *   - [POST /api/admin/clerks/[id]/strike](../../../api/admin/clerks/[clerkId]/strike/route.ts) for Issue Strike.
 */
export function ClerkAdminActions({
  clerkId,
  clerkName,
  currentStatus,
  targetRoles,
}: Props) {
  const router = useRouter()
  const [impersonating, setImpersonating] = useState(false)
  const [pending, setPending] = useState<null | AccountStatus>(null)
  const [reasonFor, setReasonFor] = useState<null | 'suspended' | 'deleted'>(
    null
  )
  const [reason, setReason] = useState('')
  const [showStrike, setShowStrike] = useState(false)
  const [strikeReason, setStrikeReason] = useState('')
  const [strikeSeverity, setStrikeSeverity] = useState('1')
  const [issuing, setIssuing] = useState(false)
  const [resetting, setResetting] = useState(false)

  async function handleImpersonate() {
    if (impersonating) return
    setImpersonating(true)
    try {
      const res = await fetch('/api/admin/impersonation/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetUserId: clerkId }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error ?? `HTTP ${res.status}`)
      }
      try {
        sessionStorage.setItem(
          'impersonating',
          JSON.stringify({
            userId: clerkId,
            name: clerkName,
            role: 'clerk',
            startedAt: new Date().toISOString(),
          })
        )
      } catch {
        /* sessionStorage may be blocked; non-fatal */
      }
      toast.success(`Now viewing as ${clerkName ?? 'clerk'}`, {
        description: 'Use the End-impersonation banner when you’re done.',
      })
      const dest = targetRoles.includes('clerk')
        ? '/clerk/dashboard'
        : '/post-signin'
      router.push(dest)
      router.refresh()
    } catch (err) {
      toast.error('Could not start impersonation', {
        description: err instanceof Error ? err.message : 'Please try again.',
      })
      setImpersonating(false)
    }
  }

  async function postStatus(
    status: AccountStatus,
    options?: { reason?: string }
  ) {
    if (pending) return
    if (status !== 'active' && !options?.reason?.trim()) {
      toast.error('Reason is required to suspend or delete')
      return
    }
    setPending(status)
    try {
      const res = await fetch(
        `/api/admin/clients/${clerkId}/account-status`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            status,
            reason: options?.reason?.trim() || undefined,
          }),
        }
      )
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error ?? `HTTP ${res.status}`)
      }
      toast.success(
        status === 'active'
          ? 'Account reactivated'
          : status === 'suspended'
            ? 'Account suspended'
            : 'Account soft-deleted'
      )
      setReason('')
      setReasonFor(null)
      router.refresh()
    } catch (err) {
      toast.error('Could not update account status', {
        description: err instanceof Error ? err.message : 'Please try again.',
      })
    } finally {
      setPending(null)
    }
  }

  async function handlePasswordReset() {
    if (resetting) return
    setResetting(true)
    try {
      const res = await fetch(`/api/admin/users/${clerkId}/password-reset`, {
        method: 'POST',
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`)
      toast.success(`Password reset email sent to ${clerkName ?? 'clerk'}`, {
        description: body?.email
          ? `Recovery link sent to ${body.email}`
          : undefined,
      })
    } catch (err) {
      toast.error('Could not send password reset', {
        description: err instanceof Error ? err.message : 'Please try again.',
      })
    } finally {
      setResetting(false)
    }
  }

  async function handleIssueStrike() {
    if (!strikeReason.trim() || issuing) return
    setIssuing(true)
    try {
      const res = await fetch(`/api/admin/clerks/${clerkId}/strike`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          severity: Number.parseInt(strikeSeverity, 10),
          reason: strikeReason.trim(),
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error ?? `HTTP ${res.status}`)
      }
      toast.success(`Strike issued to ${clerkName ?? 'clerk'}`)
      setStrikeReason('')
      setStrikeSeverity('1')
      setShowStrike(false)
      router.refresh()
    } catch (err) {
      toast.error('Could not issue strike', {
        description: err instanceof Error ? err.message : 'Please try again.',
      })
    } finally {
      setIssuing(false)
    }
  }

  return (
    <Card>
      <CardContent className="space-y-3 p-6">
        <h2 className="text-base font-semibold">Admin Actions</h2>

        {currentStatus === 'active' && (
          <ReasonAction
            expandFor="suspended"
            currentExpand={reasonFor}
            setExpand={setReasonFor}
            reason={reason}
            setReason={setReason}
            pending={pending === 'suspended'}
            onSubmit={() => postStatus('suspended', { reason })}
            icon={AlertTriangle}
            label="Suspend Account"
            tone="warn"
            consequence="Clerk can no longer log in. Notification sent with the reason."
            placeholder="Reason for suspension…"
            submitLabel="Suspend"
          />
        )}

        {currentStatus === 'suspended' && (
          <Button
            type="button"
            variant="outline"
            onClick={() => postStatus('active')}
            disabled={pending !== null}
            className="w-full justify-start gap-1.5"
          >
            {pending === 'active' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RotateCcw className="h-3.5 w-3.5" />
            )}
            Reactivate Account
          </Button>
        )}

        {currentStatus !== 'deleted' ? (
          <ReasonAction
            expandFor="deleted"
            currentExpand={reasonFor}
            setExpand={setReasonFor}
            reason={reason}
            setReason={setReason}
            pending={pending === 'deleted'}
            onSubmit={() => postStatus('deleted', { reason })}
            icon={Trash2}
            label="Delete Account"
            tone="destructive"
            consequence="Clerk is locked out and retained for 90 days. Reactivation restores access."
            placeholder="Reason for deletion…"
            submitLabel="Delete account"
          />
        ) : (
          <>
            <p className="rounded-md bg-muted/50 p-2 text-[11px] text-muted-foreground">
              Clerk is soft-deleted. Reactivating restores access; the
              original delete audit row stays for forensic trail.
            </p>
            <Button
              type="button"
              variant="outline"
              onClick={() => postStatus('active')}
              disabled={pending !== null}
              className="w-full justify-start gap-1.5"
            >
              {pending === 'active' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RotateCcw className="h-3.5 w-3.5" />
              )}
              Reactivate Account
            </Button>
          </>
        )}

        <div className="border-t border-border pt-3">
          <Button
            type="button"
            variant="outline"
            onClick={handleImpersonate}
            disabled={impersonating}
            className="w-full justify-start gap-2"
          >
            {impersonating ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Eye className="h-3.5 w-3.5" />
            )}
            Impersonate Clerk
          </Button>
        </div>

        <div className="border-t border-border pt-3">
          <p className="mb-2 text-[11px] uppercase tracking-wide text-muted-foreground">
            Password
          </p>
          <Button
            type="button"
            variant="outline"
            onClick={handlePasswordReset}
            disabled={resetting}
            className="w-full justify-start gap-2"
          >
            {resetting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <KeyRound className="h-3.5 w-3.5" />
            )}
            Send password reset email
          </Button>
          <p className="mt-1.5 text-[10px] leading-relaxed text-muted-foreground">
            Emails the clerk a one-hour recovery link. Their current password
            stays valid until they set a new one.
          </p>
        </div>

        <div className="border-t border-border pt-3">
          <p className="mb-2 text-[11px] uppercase tracking-wide text-muted-foreground">
            Strike
          </p>
          {!showStrike ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowStrike(true)}
              className="w-full justify-start gap-2 border-destructive/30 text-destructive hover:bg-destructive/5"
            >
              <AlertTriangle className="h-3.5 w-3.5" />
              Issue strike
            </Button>
          ) : (
            <div className="space-y-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
              <div>
                <Label htmlFor="severity" className="text-xs">
                  Severity
                </Label>
                <Select value={strikeSeverity} onValueChange={setStrikeSeverity}>
                  <SelectTrigger className="mt-1.5 h-9 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">1 : Warning (minor infraction)</SelectItem>
                    <SelectItem value="2">2 : Serious (no-show, conduct)</SelectItem>
                    <SelectItem value="3">3 : Severe (repeated breach)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="reason" className="text-xs">
                  Reason <span className="text-destructive">*</span>
                </Label>
                <Textarea
                  id="reason"
                  value={strikeReason}
                  onChange={(e) => setStrikeReason(e.target.value)}
                  placeholder="Describe the reason for this strike…"
                  rows={3}
                  className="mt-1.5 text-xs"
                  disabled={issuing}
                />
              </div>
              <p className="rounded bg-muted/50 p-2 text-[10px] leading-relaxed text-muted-foreground">
                <strong>Consequences:</strong> 2 strikes → tier demotion, 3 →
                30-day suspension, 4 → permanent ban. Strikes expire after 6
                months of good standing.
              </p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setShowStrike(false)
                    setStrikeReason('')
                  }}
                  disabled={issuing}
                  className="flex-1 text-xs"
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={handleIssueStrike}
                  disabled={!strikeReason.trim() || issuing}
                  className="flex-1 bg-destructive text-destructive-foreground hover:bg-destructive/90 text-xs"
                >
                  {issuing && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
                  Issue
                </Button>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function ReasonAction({
  expandFor,
  currentExpand,
  setExpand,
  reason,
  setReason,
  pending,
  onSubmit,
  icon: Icon,
  label,
  tone,
  consequence,
  placeholder,
  submitLabel,
}: {
  expandFor: 'suspended' | 'deleted'
  currentExpand: null | 'suspended' | 'deleted'
  setExpand: (v: null | 'suspended' | 'deleted') => void
  reason: string
  setReason: (v: string) => void
  pending: boolean
  onSubmit: () => void
  icon: LucideIcon
  label: string
  tone: 'warn' | 'destructive'
  consequence: string
  placeholder: string
  submitLabel: string
}) {
  if (currentExpand !== expandFor) {
    return (
      <Button
        type="button"
        variant={tone === 'destructive' ? 'destructive' : 'outline'}
        onClick={() => {
          setExpand(expandFor)
          setReason('')
        }}
        disabled={pending}
        className={`w-full justify-start gap-1.5 ${
          tone === 'destructive'
            ? ''
            : 'border-amber-500/30 text-amber-700 hover:bg-amber-50/50'
        }`}
      >
        <Icon className="h-3.5 w-3.5" />
        {label}
      </Button>
    )
  }

  return (
    <div
      className={`space-y-2 rounded-md border p-3 ${
        tone === 'destructive'
          ? 'border-destructive/30 bg-destructive/5'
          : 'border-amber-500/30 bg-amber-50/40'
      }`}
    >
      <Label
        className={`text-[11px] uppercase tracking-wide ${
          tone === 'destructive' ? 'text-destructive' : 'text-amber-700'
        }`}
      >
        {label}
      </Label>
      <p className="text-[10px] leading-relaxed text-muted-foreground">
        {consequence}
      </p>
      <Textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder={placeholder}
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
            setExpand(null)
            setReason('')
          }}
          disabled={pending}
          className="flex-1 text-xs"
        >
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={onSubmit}
          disabled={!reason.trim() || pending}
          className={`flex-1 gap-1 text-xs ${
            tone === 'destructive'
              ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
              : 'bg-amber-600 text-white hover:bg-amber-600/90'
          }`}
        >
          {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {submitLabel}
        </Button>
      </div>
    </div>
  )
}
