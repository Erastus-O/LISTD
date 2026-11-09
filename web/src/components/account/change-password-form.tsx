'use client'

import { useState } from 'react'
import { Eye, EyeOff, KeyRound, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/**
 * Inline change-password form. Calls
 * [/api/account/password](../../../api/account/password/route.ts) under
 * the user's own session — no admin elevation. Matches Lovable's UX
 * (collapsed link → expanded form on click) without depending on a
 * Dialog component.
 */
export function ChangePasswordForm() {
  const [open, setOpen] = useState(false)
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showNext, setShowNext] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [pending, setPending] = useState(false)

  async function handleSubmit() {
    if (pending) return
    if (next.length < 8) {
      toast.error('Password must be at least 8 characters')
      return
    }
    if (next !== confirm) {
      toast.error("Passwords don't match")
      return
    }
    setPending(true)
    try {
      const res = await fetch('/api/account/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPassword: next }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error ?? `HTTP ${res.status}`)
      }
      toast.success('Password updated')
      setNext('')
      setConfirm('')
      setOpen(false)
    } catch (err) {
      toast.error('Could not update password', {
        description: err instanceof Error ? err.message : 'Please try again.',
      })
    } finally {
      setPending(false)
    }
  }

  return (
    <Card>
      <CardContent className="space-y-4 p-6">
        <h2 className="flex items-center gap-1.5 text-base font-semibold">
          <KeyRound className="h-4 w-4" />
          Password
        </h2>

        {!open ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              Change the password you use to sign in. Sessions on other
              devices will need to re-authenticate.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setOpen(true)}
            >
              Change password
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <Label htmlFor="newPassword" className="mb-1.5 block">
                New password
              </Label>
              <PasswordInput
                id="newPassword"
                value={next}
                onChange={setNext}
                show={showNext}
                onToggle={() => setShowNext((v) => !v)}
                disabled={pending}
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                Minimum 8 characters.
              </p>
            </div>
            <div>
              <Label htmlFor="confirmPassword" className="mb-1.5 block">
                Confirm password
              </Label>
              <PasswordInput
                id="confirmPassword"
                value={confirm}
                onChange={setConfirm}
                show={showConfirm}
                onToggle={() => setShowConfirm((v) => !v)}
                disabled={pending}
              />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setOpen(false)
                  setNext('')
                  setConfirm('')
                }}
                disabled={pending}
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={handleSubmit}
                disabled={pending || !next || !confirm}
                className="gap-1.5"
              >
                {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Update password
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function PasswordInput({
  id,
  value,
  onChange,
  show,
  onToggle,
  disabled,
}: {
  id: string
  value: string
  onChange: (v: string) => void
  show: boolean
  onToggle: () => void
  disabled?: boolean
}) {
  return (
    <div className="relative">
      <Input
        id={id}
        type={show ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        autoComplete="new-password"
        className="pr-10"
      />
      <button
        type="button"
        onClick={onToggle}
        disabled={disabled}
        className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
        tabIndex={-1}
        aria-label={show ? 'Hide password' : 'Show password'}
      >
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  )
}
