'use client'

import { useState } from 'react'
import { AlertCircle, CheckCircle2, CreditCard, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

type Props = {
  configured: boolean
  status: string // none | pending | restricted | complete
  payoutsEnabled: boolean
  /** Set when the clerk was redirected here after trying to accept a job
   *  without payouts set up — surfaces a prompt above the card. */
  highlight?: boolean
}

/**
 * Clerk payouts onboarding. Starts Stripe Express onboarding and redirects to
 * the hosted account link. Funds for a completed job are released to the
 * clerk's connected account once the admin approves the report.
 */
export function StripePayoutsCard({
  configured,
  status,
  payoutsEnabled,
  highlight = false,
}: Props) {
  const [busy, setBusy] = useState(false)

  async function go(endpoint: string, failMsg: string) {
    if (busy) return
    setBusy(true)
    try {
      const res = await fetch(endpoint, { method: 'POST' })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.url) {
        throw new Error(data?.error ?? `HTTP ${res.status}`)
      }
      window.location.href = data.url as string
    } catch (err) {
      toast.error(failMsg, {
        description: err instanceof Error ? err.message : 'Please try again.',
      })
      setBusy(false)
    }
  }

  const start = () =>
    go('/api/stripe/connect/onboard', 'Could not start payouts setup')
  const manage = () =>
    go('/api/stripe/connect/dashboard', 'Could not open your payout dashboard')

  const ready = payoutsEnabled && status === 'complete'

  return (
    <div className="space-y-2">
      {highlight && !ready && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-800">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <p className="text-xs">
            You need to set up payouts before you can accept jobs: finish the
            quick Stripe setup below so we can pay you when your reports are
            approved.
          </p>
        </div>
      )}
      <Card>
      <CardContent className="flex items-start justify-between gap-4 p-5">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            {ready ? (
              <CheckCircle2 className="h-4 w-4" />
            ) : (
              <CreditCard className="h-4 w-4" />
            )}
          </span>
          <div>
            <p className="text-sm font-medium text-foreground">
              Payouts {ready ? '— set up' : ''}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {!configured
                ? 'Payouts aren’t configured on this server yet.'
                : ready
                  ? 'You’ll be paid to your connected account once your completed work is approved.'
                  : status === 'restricted'
                    ? 'Stripe needs more information before you can be paid. Continue setup.'
                    : status === 'pending'
                      ? 'Finish setting up your Stripe payout account to get paid.'
                      : 'Connect a Stripe account so you can be paid when your reports are approved.'}
            </p>
          </div>
        </div>
        {configured && !ready && (
          <Button size="sm" onClick={start} disabled={busy}>
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : status === 'none' ? (
              'Set up payouts'
            ) : (
              'Continue setup'
            )}
          </Button>
        )}
        {configured && ready && (
          <Button size="sm" variant="outline" onClick={manage} disabled={busy}>
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              'Manage payouts'
            )}
          </Button>
        )}
      </CardContent>
      </Card>
    </div>
  )
}
