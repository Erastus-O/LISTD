'use client'

import { useState } from 'react'
import { Eye, EyeOff, Lock, type LucideIcon } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

/**
 * Shared building blocks for the auth screens (sign in, sign up, forgot and
 * reset password). Rendered inside AuthShell.
 */

export const AUTH_PRIMARY_BUTTON = 'h-12 w-full text-base font-semibold'

export const AUTH_SECONDARY_BUTTON = 'h-12 w-full text-base font-semibold'

const FIELD_CLASS = 'h-12 pl-11 text-base'

export function AuthHeading({
  title,
  children,
}: {
  /** Accepted for older call sites; the design has no eyebrow here. */
  eyebrow?: string
  title: string
  children?: React.ReactNode
}) {
  return (
    <div className="mb-6">
      <h1>{title}</h1>
      {children && <p className="a-muted mt-2">{children}</p>}
    </div>
  )
}

type IconInputProps = React.ComponentProps<typeof Input> & {
  icon: LucideIcon
}

export function IconInput({ icon: Icon, className, ...props }: IconInputProps) {
  return (
    <div className="relative">
      <Icon
        className="pointer-events-none absolute top-1/2 left-4 h-4 w-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <Input className={cn(FIELD_CLASS, className)} {...props} />
    </div>
  )
}

/** Password field with its own show/hide toggle. */
export function PasswordInput({
  className,
  ...props
}: Omit<React.ComponentProps<typeof Input>, 'type'>) {
  const [visible, setVisible] = useState(false)
  return (
    <div className="relative">
      <Lock
        className="pointer-events-none absolute top-1/2 left-4 h-4 w-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <Input
        type={visible ? 'text' : 'password'}
        className={cn(FIELD_CLASS, 'pr-12', className)}
        {...props}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        className="absolute top-1/2 right-2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        aria-label={visible ? 'Hide password' : 'Show password'}
      >
        {visible ? (
          <EyeOff className="h-4 w-4" aria-hidden />
        ) : (
          <Eye className="h-4 w-4" aria-hidden />
        )}
      </button>
    </div>
  )
}

const STRENGTH_LABELS = ['Too short', 'Weak', 'Fair', 'Good', 'Strong'] as const
const STRENGTH_COLORS = [
  'bg-destructive',
  'bg-destructive',
  'bg-warning',
  'bg-primary',
  'bg-success',
] as const

/** 0 to 4. Length gates everything; variety adds the rest. */
function scorePassword(pw: string): number {
  if (pw.length < 8) return 0
  let score = 1
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++
  if (/\d/.test(pw)) score++
  if (/[^A-Za-z0-9]/.test(pw) || pw.length >= 14) score++
  return score
}

/** Four-segment strength meter shown under a new-password field. */
export function PasswordStrength({ value }: { value: string }) {
  if (!value) return null
  const score = scorePassword(value)
  return (
    <div className="mt-2" aria-live="polite">
      <div className="flex gap-1.5" aria-hidden>
        {[1, 2, 3, 4].map((i) => (
          <span
            key={i}
            className={cn(
              'h-1 flex-1 rounded-full transition-colors',
              score >= i ? STRENGTH_COLORS[score] : 'bg-border'
            )}
          />
        ))}
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">
        Password strength:{' '}
        <span className="font-medium text-foreground">
          {STRENGTH_LABELS[score]}
        </span>
      </p>
    </div>
  )
}
