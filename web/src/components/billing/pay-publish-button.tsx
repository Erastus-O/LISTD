'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'

/**
 * Owner action for a worker's post that's awaiting payment. Mints a fresh
 * Stripe Checkout session (so an expired link is replaced) and redirects to
 * pay. The job publishes once payment completes.
 */
export function PayPublishButton({ jobId }: { jobId: string }) {
  const [pending, setPending] = useState(false)

  async function handlePay() {
    if (pending) return
    setPending(true)
    try {
      const res = await fetch(`/api/client/jobs/${jobId}/payment-link`, {
        method: 'POST',
      })
      const body = (await res.json().catch(() => null)) as {
        url?: string
        error?: string
      } | null
      if (!res.ok || !body?.url) {
        throw new Error(body?.error ?? `HTTP ${res.status}`)
      }
      toast.message('Redirecting to secure payment…')
      window.location.href = body.url
    } catch (err) {
      toast.error('Could not start payment', {
        description: err instanceof Error ? err.message : 'Please try again.',
      })
      setPending(false)
    }
  }

  return (
    <Button type="button" size="sm" onClick={handlePay} disabled={pending} className="gap-1.5">
      {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
      Pay &amp; publish
    </Button>
  )
}
