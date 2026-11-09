'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Lock } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type Props = { forced: boolean }

const MIN_PASSWORD_LENGTH = 8

/**
 * Form for the forced-password-reset page. Posts to `/api/account/password`
 * which updates the Supabase auth password AND clears
 * `profiles.password_must_change` so the next render escapes the gate.
 *
 * Routes the user to their role-appropriate dashboard after success — the
 * worker invite flow lands here on first login, so we want them landing
 * somewhere useful rather than back at the auth page.
 */
export function ForcePasswordResetForm({ forced }: Props) {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [pending, setPending] = useState(false)

  const tooShort = password.length > 0 && password.length < MIN_PASSWORD_LENGTH
  const mismatch =
    confirm.length > 0 && password.length > 0 && password !== confirm
  const canSubmit =
    password.length >= MIN_PASSWORD_LENGTH && password === confirm && !pending

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    setPending(true)
    try {
      const res = await fetch('/api/account/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPassword: password }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error ?? `HTTP ${res.status}`)
      }
      toast.success('Password updated')
      // After a forced reset, the user's `password_must_change` flag was
      // just cleared server-side — `router.refresh()` re-fetches the layout
      // session and the gate stops firing. Then push to the dashboard.
      router.refresh()
      router.push(forced ? '/worker/dashboard' : '/client/dashboard')
    } catch (err) {
      toast.error('Could not change password', {
        description: err instanceof Error ? err.message : 'Please try again.',
      })
      setPending(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <Label htmlFor="new-password" className="text-xs">
          New password
        </Label>
        <Input
          id="new-password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={pending}
          className="mt-1"
          minLength={MIN_PASSWORD_LENGTH}
          required
        />
        {tooShort && (
          <p className="mt-1 text-[11px] text-amber-700">
            Use at least {MIN_PASSWORD_LENGTH} characters.
          </p>
        )}
      </div>
      <div>
        <Label htmlFor="confirm-password" className="text-xs">
          Confirm new password
        </Label>
        <Input
          id="confirm-password"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          disabled={pending}
          className="mt-1"
          required
        />
        {mismatch && (
          <p className="mt-1 text-[11px] text-destructive">
            Passwords don&apos;t match.
          </p>
        )}
      </div>
      <Button
        type="submit"
        disabled={!canSubmit}
        className="w-full gap-1.5"
      >
        {pending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Lock className="h-4 w-4" />
        )}
        Update password
      </Button>
    </form>
  )
}
