'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CreditCard, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent } from '@/components/ui/card'

type Mode = 'owner_link' | 'worker_pays'

const OPTIONS: { value: Mode; title: string; description: string }[] = [
  {
    value: 'owner_link',
    title: 'I pay, via a payment link',
    description:
      'When a worker posts a job it stays unpublished and a secure Stripe payment link is sent to you (in-app and by email). The job publishes once you pay.',
  },
  {
    value: 'worker_pays',
    title: 'The worker pays at checkout',
    description:
      'Workers complete the payment themselves when they post, exactly as you do. Their post publishes as soon as they pay.',
  },
]

/**
 * Owner-only control for how a worker's posts are paid for. Defaults to the
 * payment-link option until the owner chooses otherwise (migration 0032 sets
 * the org column default to 'owner_link').
 */
export function WorkerPaymentModeCard({ initialMode }: { initialMode: Mode }) {
  const router = useRouter()
  const [mode, setMode] = useState<Mode>(initialMode)
  const [pending, setPending] = useState<Mode | null>(null)

  async function choose(next: Mode) {
    if (next === mode || pending) return
    setPending(next)
    const prev = mode
    setMode(next) // optimistic
    try {
      const res = await fetch('/api/client/org/payment-mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: next }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error ?? `HTTP ${res.status}`)
      }
      toast.success('Payment setting saved')
      router.refresh()
    } catch (err) {
      setMode(prev) // revert
      toast.error('Could not save setting', {
        description: err instanceof Error ? err.message : 'Please try again.',
      })
    } finally {
      setPending(null)
    }
  }

  return (
    <Card>
      <CardContent className="space-y-3 p-6">
        <div className="flex items-center gap-2">
          <CreditCard className="h-4 w-4 text-primary" />
          <h2 className="text-base font-semibold">Worker post payments</h2>
        </div>
        <p className="text-xs text-muted-foreground">
          Choose who pays when a member of your team posts a job.
        </p>
        <div className="space-y-2">
          {OPTIONS.map((opt) => {
            const selected = mode === opt.value
            const busy = pending === opt.value
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => choose(opt.value)}
                disabled={!!pending}
                aria-pressed={selected}
                className={`flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors disabled:opacity-60 ${
                  selected
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-primary/40'
                }`}
              >
                <span
                  className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                    selected ? 'border-primary' : 'border-muted-foreground/40'
                  }`}
                  aria-hidden
                >
                  {selected && (
                    <span className="h-2 w-2 rounded-full bg-primary" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                    {opt.title}
                    {busy && (
                      <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                    )}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {opt.description}
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
