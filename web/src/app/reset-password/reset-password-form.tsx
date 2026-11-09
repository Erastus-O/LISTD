'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { ArrowRight, CheckCircle2, KeyRound, Link2Off, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import {
  AUTH_PRIMARY_BUTTON,
  AuthHeading,
  PasswordInput,
  PasswordStrength,
} from '@/components/auth/auth-ui'
import { createClient } from '@/lib/supabase/client'

const schema = z
  .object({
    password: z.string().min(8, 'Password must be at least 8 characters'),
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })

type FormData = z.infer<typeof schema>

/**
 * Rendered inside AuthShell (see page.tsx).
 *
 * Two ways in:
 *   - `?token_hash=…&type=recovery` (our emails, see lib/auth/recovery-link):
 *     the token is only verified when the user presses Continue, so email
 *     scanners that pre-open links can't burn it.
 *   - A session already set by Supabase's own /verify redirect (hash tokens
 *     or `?code=`), e.g. older emails. Detected by the effect below.
 */
export function ResetPasswordForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const tokenHash =
    searchParams.get('type') === 'recovery'
      ? searchParams.get('token_hash')
      : null

  const [isLoading, setIsLoading] = useState(false)
  const [isSuccess, setIsSuccess] = useState(false)
  const [isValidSession, setIsValidSession] = useState(false)
  const [isChecking, setIsChecking] = useState(!tokenHash)
  const [isVerifying, setIsVerifying] = useState(false)
  const [tokenFailed, setTokenFailed] = useState(false)
  const [linkError, setLinkError] = useState<string | null>(null)

  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { password: '', confirmPassword: '' },
  })
  const password = useWatch({ control: form.control, name: 'password' })

  useEffect(() => {
    // Token-hash links wait for the Continue click instead.
    if (tokenHash) return
    const supabase = createClient()
    let done = false
    const markValid = () => {
      if (done) return
      done = true
      setIsValidSession(true)
      setIsChecking(false)
    }

    // Accept ANY session that arrives from the recovery hash. supabase-ssr may
    // emit SIGNED_IN / INITIAL_SESSION rather than PASSWORD_RECOVERY, so keying
    // off the event type alone was too brittle (the old 1s window often missed).
    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => {
      if (sess) markValid()
    })
    void supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        markValid()
        return
      }
      // No session. If Supabase bounced an error back in the hash (e.g. an
      // expired or already-used link), surface the exact reason.
      if (
        typeof window !== 'undefined' &&
        window.location.hash.includes('error')
      ) {
        const params = new URLSearchParams(window.location.hash.replace(/^#/, ''))
        const desc = params.get('error_description')
        if (desc) setLinkError(decodeURIComponent(desc.replace(/\+/g, ' ')))
      }
    })

    // Grace period: if no session materialises, drop the spinner and show the
    // invalid/expired state.
    const timer = setTimeout(() => setIsChecking(false), 3000)
    return () => {
      sub.subscription.unsubscribe()
      clearTimeout(timer)
    }
  }, [tokenHash])

  async function handleContinue() {
    if (!tokenHash) return
    setIsVerifying(true)
    const supabase = createClient()
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: 'recovery',
    })
    setIsVerifying(false)
    if (error) {
      setLinkError(error.message)
      setTokenFailed(true)
      return
    }
    setIsValidSession(true)
    // The token is spent; drop it from the address bar and history.
    router.replace('/reset-password')
  }

  async function handleReset(data: FormData) {
    setIsLoading(true)
    const supabase = createClient()
    const { error } = await supabase.auth.updateUser({ password: data.password })
    setIsLoading(false)

    if (error) {
      toast.error('Failed to reset password', {
        description: error.message || 'An error occurred. Please try again.',
      })
      return
    }
    setIsSuccess(true)
    toast.success('Password updated!', {
      description: 'Your password has been successfully reset.',
    })
    setTimeout(() => router.push('/post-signin'), 2000)
  }

  if (tokenHash && !tokenFailed && !isValidSession) {
    return (
      <div className="animate-fade-in">
        <span className="mb-6 grid h-14 w-14 place-items-center rounded-2xl bg-primary/10 text-primary">
          <KeyRound className="h-7 w-7" aria-hidden />
        </span>
        <AuthHeading eyebrow="Account recovery" title="Reset your password">
          Continue to choose a new password for your LISTD account.
        </AuthHeading>
        <Button
          type="button"
          onClick={handleContinue}
          className={AUTH_PRIMARY_BUTTON}
          disabled={isVerifying}
        >
          {isVerifying ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Verifying link...
            </>
          ) : (
            <>
              Continue
              <ArrowRight className="h-4 w-4" aria-hidden />
            </>
          )}
        </Button>
      </div>
    )
  }

  if (isChecking) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex flex-col items-center gap-4 py-16 text-center"
      >
        <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden />
        <p className="text-sm text-muted-foreground">Verifying your reset link...</p>
      </div>
    )
  }

  if (!isValidSession) {
    return (
      <div className="animate-fade-in">
        <span className="mb-6 grid h-14 w-14 place-items-center rounded-2xl bg-destructive/10 text-destructive">
          <Link2Off className="h-7 w-7" aria-hidden />
        </span>
        <AuthHeading title="This link has expired">
          {linkError ?? 'This password reset link is invalid or has expired.'}
        </AuthHeading>
        <p className="mb-6 rounded-xl border border-border/80 bg-muted/30 p-4 text-sm text-muted-foreground">
          Request a fresh link from the sign-in page, then open the most recent
          email promptly. Older links stop working once a new one is sent.
        </p>
        <Button asChild className={AUTH_PRIMARY_BUTTON}>
          <Link href="/auth">Back to sign in</Link>
        </Button>
      </div>
    )
  }

  if (isSuccess) {
    return (
      <div className="animate-fade-in" role="status">
        <span className="mb-6 grid h-14 w-14 place-items-center rounded-2xl bg-success/10 text-success">
          <CheckCircle2 className="h-7 w-7" aria-hidden />
        </span>
        <AuthHeading title="Password updated">
          Taking you to your dashboard...
        </AuthHeading>
      </div>
    )
  }

  return (
    <div className="animate-fade-in">
      <AuthHeading eyebrow="Account recovery" title="Set a new password">
        Choose a strong password you don&rsquo;t use anywhere else.
      </AuthHeading>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(handleReset)} className="space-y-5">
          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem>
                <FormLabel>New password</FormLabel>
                <FormControl>
                  <PasswordInput
                    autoComplete="new-password"
                    placeholder="At least 8 characters"
                    {...field}
                  />
                </FormControl>
                <PasswordStrength value={password} />
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="confirmPassword"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Confirm new password</FormLabel>
                <FormControl>
                  <PasswordInput
                    autoComplete="new-password"
                    placeholder="Repeat your password"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <Button
            type="submit"
            className={AUTH_PRIMARY_BUTTON}
            disabled={isLoading}
          >
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                Updating password...
              </>
            ) : (
              'Update password'
            )}
          </Button>
        </form>
      </Form>
    </div>
  )
}
