'use client'

import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { ArrowLeft, Loader2, Mail, MailCheck, RotateCcw } from 'lucide-react'
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
  AUTH_SECONDARY_BUTTON,
  AuthHeading,
  IconInput,
} from '@/components/auth/auth-ui'

const forgotPasswordSchema = z.object({
  email: z.string().email('Please enter a valid email address').max(255),
})

type FormData = z.infer<typeof forgotPasswordSchema>

export function ForgotPasswordForm({ onBack }: { onBack: () => void }) {
  const [isLoading, setIsLoading] = useState(false)
  const [isSuccess, setIsSuccess] = useState(false)
  const [resendCountdown, setResendCountdown] = useState(0)
  const [lastEmail, setLastEmail] = useState('')

  useEffect(() => {
    if (resendCountdown <= 0) return
    const timer = setTimeout(() => setResendCountdown((c) => c - 1), 1000)
    return () => clearTimeout(timer)
  }, [resendCountdown])

  const form = useForm<FormData>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: '' },
  })

  /**
   * Returns true when the request was accepted. The API answers 200 for
   * unknown emails too (no account enumeration), so a non-2xx here is a real
   * failure (rate limit, rejected redirect, server error) and must not be
   * reported to the user as "sent".
   */
  async function sendResetEmail(email: string): Promise<boolean> {
    const redirectUrl = `${window.location.origin}/reset-password`
    try {
      const res = await fetch('/api/auth/password-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, redirectUrl }),
      })
      if (res.ok) return true
      console.error('[forgot-password] failed: HTTP', res.status)
      toast.error(
        res.status === 429
          ? 'Too many attempts'
          : 'We couldn’t send the reset email',
        {
          description:
            res.status === 429
              ? 'Please wait a few minutes before trying again.'
              : 'Please try again, or contact support@listd.co.uk if it keeps happening.',
        }
      )
      return false
    } catch (err) {
      console.error('[forgot-password] failed:', err)
      toast.error('We couldn’t send the reset email', {
        description: 'Check your connection and try again.',
      })
      return false
    }
  }

  async function handleSubmit(data: FormData) {
    setIsLoading(true)
    const sent = await sendResetEmail(data.email)
    setIsLoading(false)
    if (!sent) return
    setLastEmail(data.email)
    setIsSuccess(true)
    setResendCountdown(60)
    toast.success('Check your email', {
      description: "If an account exists for that address, we've sent a reset link.",
    })
  }

  async function handleResend() {
    if (resendCountdown > 0 || !lastEmail) return
    setIsLoading(true)
    const sent = await sendResetEmail(lastEmail)
    setIsLoading(false)
    if (!sent) return
    setResendCountdown(60)
    toast.success('Email resent', {
      description: "We've sent another password reset link.",
    })
  }

  const backButton = (
    <button
      type="button"
      onClick={onBack}
      className="mb-8 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden />
      Back to sign in
    </button>
  )

  if (isSuccess) {
    return (
      <div className="animate-fade-in">
        {backButton}
        <span className="mb-6 grid h-14 w-14 place-items-center rounded-2xl bg-primary/10 text-primary">
          <MailCheck className="h-7 w-7" aria-hidden />
        </span>
        <AuthHeading title="Check your email">
          We&rsquo;ve sent a reset link to{' '}
          <span className="font-medium text-foreground">{lastEmail}</span>.
          The link expires in 1 hour.
        </AuthHeading>
        <Button
          variant="outline"
          onClick={handleResend}
          disabled={resendCountdown > 0 || isLoading}
          className={AUTH_SECONDARY_BUTTON}
        >
          <RotateCcw className="h-4 w-4" aria-hidden />
          {resendCountdown > 0
            ? `Resend email in ${resendCountdown}s`
            : isLoading
              ? 'Sending...'
              : 'Resend reset email'}
        </Button>
        <p className="mt-4 text-center text-xs text-muted-foreground">
          Can&rsquo;t find it? Check your spam folder, and always open the most
          recent email.
        </p>
      </div>
    )
  }

  return (
    <div className="animate-fade-in">
      {backButton}
      <AuthHeading eyebrow="Account recovery" title="Forgot your password?">
        Enter your email address and we&rsquo;ll send you a link to reset it.
      </AuthHeading>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-5">
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Email</FormLabel>
                <FormControl>
                  <IconInput
                    icon={Mail}
                    type="email"
                    autoComplete="email"
                    placeholder="you@company.co.uk"
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
                Sending...
              </>
            ) : (
              'Send reset link'
            )}
          </Button>
        </form>
      </Form>
    </div>
  )
}
