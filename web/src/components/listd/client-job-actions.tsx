'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'
import { Icon } from '@/components/listd/icon'
import { Textarea } from '@/components/ui/textarea'
import type { QuoteLine } from '@/lib/listd/pricing'

const money = (p: number) => `£${(p / 100).toFixed(2)}`

export type ClientQuote = {
  version: number
  lines: QuoteLine[]
  totalP: number
  why: string | null
  expiresAt: string | null
  exclusions: string | null
}

export type ClientChangeOrder = { id: string; description: string; totalP: number | null; creditP: number; status: string }

async function post(url: string, body?: unknown) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json().catch(() => null)
  if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`)
  return json
}

/**
 * The client's next action on a booking: accept a quote, approve the finished
 * job, ask for corrections, raise a dispute, decide extra work.
 */
export function ClientJobActions({
  jobId,
  status,
  reviewDueAt,
  quote,
  changeOrders,
}: {
  jobId: string
  status: string
  reviewDueAt: string | null
  quote: ClientQuote | null
  changeOrders: ClientChangeOrder[]
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [panel, setPanel] = useState<null | 'correct' | 'dispute'>(null)
  const [text, setText] = useState('')

  async function run(fn: () => Promise<unknown>, done: string) {
    setBusy(true)
    try {
      await fn()
      toast.success(done)
      setPanel(null)
      setText('')
      router.refresh()
    } catch (err) {
      toast.error('That didn’t work', { description: err instanceof Error ? err.message : 'Please try again.' })
    } finally {
      setBusy(false)
    }
  }

  async function acceptQuote() {
    setBusy(true)
    try {
      const json = await post(`/api/client/jobs/${jobId}/quote`, { action: 'accept' })
      if (json.checkoutUrl) {
        window.location.href = json.checkoutUrl
        return
      }
      toast.success('Quote accepted')
      router.refresh()
    } catch (err) {
      toast.error('That didn’t work', { description: err instanceof Error ? err.message : 'Please try again.' })
    } finally {
      setBusy(false)
    }
  }

  const priced = changeOrders.filter((c) => c.status === 'PRICED')
  const showQuote = status === 'pending' && quote
  const waitingForQuote = status === 'pending' && !quote
  const canApprove = status === 'reviewed'

  if (!showQuote && !waitingForQuote && !canApprove && !priced.length) return null

  return (
    <div className="a-card grid gap-4">
      {waitingForQuote && (
        <div>
          <h2 className="text-lg font-semibold">LISTD is preparing your quote</h2>
          <p className="a-muted mt-1 text-sm">Nothing is charged until you accept a fixed quote and pay.</p>
        </div>
      )}

      {showQuote && (
        <>
          <div>
            <h2 className="text-lg font-semibold">Your quote{quote.version > 1 ? ` (updated, version ${quote.version})` : ''}</h2>
            {quote.why && <p className="a-muted mt-1 text-sm">{quote.why}</p>}
          </div>
          <div className="a-summary">
            {quote.lines.map((l, i) => (
              <div key={i} className="line">
                <span>{l.d}{l.q > 1 ? ` × ${l.q}` : ''}</span>
                <b>{money(l.q * l.u)}</b>
              </div>
            ))}
            <div className="line tot">
              <span>Total</span>
              <span>{money(quote.totalP)}</span>
            </div>
          </div>
          {quote.exclusions && <p className="a-fine">Not included: {quote.exclusions}</p>}
          {quote.expiresAt && <p className="a-fine">Valid until {new Date(quote.expiresAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}.</p>}
          <div className="flex flex-wrap gap-3">
            <button type="button" className="ld-btn ld-btn-primary" disabled={busy} onClick={acceptQuote}>
              Accept and pay {money(quote.totalP)}
            </button>
            <button
              type="button"
              className="ld-btn ld-btn-secondary"
              disabled={busy}
              onClick={() => run(() => post(`/api/client/jobs/${jobId}/quote`, { action: 'decline' }), 'Quote declined')}
            >
              Decline
            </button>
          </div>
        </>
      )}

      {canApprove && (
        <>
          <div>
            <h2 className="text-lg font-semibold">Ready to approve</h2>
            <p className="a-muted mt-1 text-sm">
              Check the evidence, then approve the finished job. Payment is released to the Pro when you approve.
              {reviewDueAt ? ` If there are no corrections or disputes, it completes automatically on ${new Date(reviewDueAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}.` : ' The review window is paused.'}
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              className="ld-btn ld-btn-primary"
              disabled={busy}
              onClick={() => run(() => post(`/api/client/jobs/${jobId}/approve`), 'Job approved')}
            >
              <Icon name="check" size={18} /> Approve finished job
            </button>
            <button type="button" className="ld-btn ld-btn-secondary" disabled={busy} onClick={() => setPanel(panel === 'correct' ? null : 'correct')}>
              Request corrections
            </button>
            <button type="button" className="ld-btn ld-btn-ghost" disabled={busy} onClick={() => setPanel(panel === 'dispute' ? null : 'dispute')}>
              Raise a dispute
            </button>
          </div>
          {panel && (
            <div className="grid gap-3">
              <label className="text-sm font-medium" htmlFor="action-text">
                {panel === 'correct' ? 'What needs correcting?' : 'What went wrong? LISTD reviews the evidence and both sides.'}
              </label>
              <Textarea id="action-text" value={text} onChange={(e) => setText(e.target.value)} />
              <div>
                <button
                  type="button"
                  className="ld-btn ld-btn-primary"
                  disabled={busy || text.trim().length < 3}
                  onClick={() =>
                    panel === 'correct'
                      ? run(() => post(`/api/client/jobs/${jobId}/request-correction`, { text }), 'Sent to the Pro')
                      : run(() => post(`/api/client/jobs/${jobId}/dispute`, { reason: 'Client dispute', description: text }), 'Dispute raised. The payout is frozen until it’s settled.')
                  }
                >
                  {panel === 'correct' ? 'Send to the Pro' : 'Raise dispute'}
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {priced.map((c) => (
        <div key={c.id} className="grid gap-2 border-t border-border pt-4 first:border-t-0 first:pt-0">
          <h2 className="text-lg font-semibold">Extra work needs your approval</h2>
          <p className="text-sm">{c.description}</p>
          <p className="text-sm font-semibold">
            {money(c.totalP ?? 0)}
            {c.creditP ? <span className="a-muted font-normal"> after your {money(c.creditP)} diagnosis credit</span> : null}
          </p>
          <div className="flex flex-wrap gap-3">
            <button type="button" className="ld-btn ld-btn-primary" disabled={busy} onClick={() => run(() => post(`/api/client/change-orders/${c.id}`, { approve: true }), 'Extra work approved')}>
              Approve
            </button>
            <button type="button" className="ld-btn ld-btn-secondary" disabled={busy} onClick={() => run(() => post(`/api/client/change-orders/${c.id}`, { approve: false }), 'Extra work declined')}>
              Decline
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
