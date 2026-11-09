'use client'

import { useState } from 'react'
import { CreditCard, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'

type Props = {
  invoiceId: string
  outstandingLabel: string
}

/**
 * Pay Now button — hits POST /api/billing/invoices/[id]/payment-link to
 * create a Stripe Checkout session, then redirects the browser to the
 * hosted URL. The webhook handler records the payment when Stripe pings
 * back; this surface is purely "kick off checkout".
 *
 * Rendered only when:
 *   - the active billing provider implements payment links, AND
 *   - the viewer is the invoice's client (server-side check), AND
 *   - there's an outstanding balance > 0
 */
export function PayNowButton({ invoiceId, outstandingLabel }: Props) {
  const [pending, setPending] = useState(false)

  async function start() {
    setPending(true)
    try {
      const res = await fetch(
        `/api/billing/invoices/${invoiceId}/payment-link`,
        { method: 'POST' }
      )
      const json = (await res.json().catch(() => ({}))) as {
        checkoutUrl?: string
        error?: string
      }
      if (!res.ok || !json.checkoutUrl) {
        throw new Error(json.error ?? `HTTP ${res.status}`)
      }
      // Stripe Checkout is a full-page redirect — don't open in a new tab.
      window.location.href = json.checkoutUrl
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Could not start checkout'
      )
      setPending(false)
    }
  }

  return (
    <Button
      type="button"
      onClick={start}
      disabled={pending}
      className="w-full gap-1.5"
    >
      {pending ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <CreditCard className="h-3.5 w-3.5" />
      )}
      Pay {outstandingLabel}
    </Button>
  )
}
