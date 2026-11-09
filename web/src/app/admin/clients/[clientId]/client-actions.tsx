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
import { Textarea } from '@/components/ui/textarea'

type AccountStatus = 'active' | 'suspended' | 'deleted'

type Props = {
  clientId: string
  clientName: string | null
  currentStatus: AccountStatus
}

/**
 * Admin client-detail action panel (S6d, with status transitions wired
 * after migration 0005 added `profiles.account_status`).
 *
 * Two pieces:
 *   - **Impersonate** — POSTs to the audit-wired
 *     [`/api/admin/impersonation/start`](../../../api/admin/impersonation/start/route.ts)
 *     (M1 #22 Package B), sets the `sessionStorage` flag mirroring Lovable's
 *     pattern, routes to `/client/dashboard`.
 *   - **Status transitions** — Suspend / Reactivate / Soft-delete via
 *     [POST /api/admin/clients/[id]/account-status](../../../api/admin/clients/[clientId]/account-status/route.ts).
 *     Reason required for suspend + delete; captured in the audit row + the
 *     in-app notification body. Soft-delete keeps the row for 90-day audit
 *     retention; reactivating from `deleted → active` clears `deleted_at`.
 */
export function ClientAdminActions({
  clientId,
  clientName,
  currentStatus,
}: Props) {
  const router = useRouter()
  const [impersonating, setImpersonating] = useState(false)
  const [pending, setPending] = useState<null | AccountStatus>(null)
  const [resetting, setResetting] = useState(false)

  // Inline-expand reason capture for Suspend / Delete. Reactivate doesn't
  // need a reason so it skips the form and posts directly.
  const [reasonFor, setReasonFor] = useState<null | 'suspended' | 'deleted'>(
    null
  )
  const [reason, setReason] = useState('')

  async function handleImpersonate() {
    if (impersonating) return
    setImpersonating(true)
    try {
      const res = await fetch('/api/admin/impersonation/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetUserId: clientId }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error ?? `HTTP ${res.status}`)
      }
      try {
        sessionStorage.setItem(
          'impersonating',
          JSON.stringify({
            userId: clientId,
            name: clientName,
            role: 'client',
            startedAt: new Date().toISOString(),
          })
        )
      } catch {
        /* sessionStorage may be blocked; non-fatal */
      }
      toast.success(`Now viewing as ${clientName ?? 'client'}`, {
        description: 'Use the End-impersonation banner when you’re done.',
      })
      router.push('/client/dashboard')
      router.refresh()
    } catch (err) {
      toast.error('Could not start impersonation', {
        description: err instanceof Error ? err.message : 'Please try again.',
      })
      setImpersonating(false)
    }
  }

  async function handlePasswordReset() {
    if (resetting) return
    setResetting(true)
    try {
      const res = await fetch(`/api/admin/users/${clientId}/password-reset`, {
        method: 'POST',
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`)
      toast.success(`Password reset email sent to ${clientName ?? 'client'}`, {
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
        `/api/admin/clients/${clientId}/account-status`,
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

  return (
    <Card>
      <CardContent className="space-y-4 p-6">
        <h2 className="text-sm font-semibold">Admin actions</h2>

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
          View as {clientName ?? 'this client'}
        </Button>

        <div className="space-y-2 border-t border-border pt-4">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
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
          <p className="text-[10px] leading-relaxed text-muted-foreground">
            Emails the client a one-hour recovery link. Their current password
            stays valid until they set a new one.
          </p>
        </div>

        <div className="space-y-2 border-t border-border pt-4">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Account status
          </p>

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
              label="Suspend account"
              tone="warn"
              consequence="Client can no longer log in. Notification sent to user with the reason."
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
              Reactivate account
            </Button>
          )}

          {currentStatus === 'deleted' && (
            <>
              <p className="rounded-md bg-muted/50 p-2 text-[11px] text-muted-foreground">
                Account is soft-deleted. Reactivating restores access; the
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
                Reactivate account
              </Button>
            </>
          )}

          {currentStatus !== 'deleted' && (
            <ReasonAction
              expandFor="deleted"
              currentExpand={reasonFor}
              setExpand={setReasonFor}
              reason={reason}
              setReason={setReason}
              pending={pending === 'deleted'}
              onSubmit={() => postStatus('deleted', { reason })}
              icon={Trash2}
              label="Soft-delete account"
              tone="destructive"
              consequence="Account is locked out and retained for 90 days. Reactivation restores access."
              placeholder="Reason for deletion…"
              submitLabel="Delete account"
            />
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
        variant="outline"
        onClick={() => {
          setExpand(expandFor)
          setReason('')
        }}
        disabled={pending}
        className={`w-full justify-start gap-1.5 ${
          tone === 'destructive'
            ? 'border-destructive/30 text-destructive hover:bg-destructive/5'
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
