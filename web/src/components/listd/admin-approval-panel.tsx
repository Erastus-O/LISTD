'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'

export type ApprovalPro = {
  userId: string
  name: string | null
  verification: string | null
  level: number
  completed: number
  rating: number | null
}

/** Shown on a job a Pro has accepted, until LISTD approves or declines. */
export function AdminApprovalPanel({ jobId, pro, acceptedAt, netP }: { jobId: string; pro: ApprovalPro | null; acceptedAt: string | null; netP: number }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [declining, setDeclining] = useState(false)
  const [reason, setReason] = useState('')

  async function decide(body: Record<string, unknown>, done: string) {
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/jobs/${jobId}/approval`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`)
      toast.success(done)
      router.refresh()
    } catch (err) {
      toast.error('That didn’t work', { description: err instanceof Error ? err.message : undefined })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="a-card grid gap-3 border-primary/40">
      <div>
        <h2 className="text-base font-semibold">Approve this booking</h2>
        <p className="a-muted mt-1 text-sm">
          A Pro accepted{acceptedAt ? ` on ${new Date(acceptedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}. Approving unlocks the address, access codes and contacts, and sends them the brief and platform rules. The client is told a Pro is booked.
        </p>
      </div>
      {pro && (
        <div className="a-summary">
          <div className="line">
            <span>Pro</span>
            <b>
              <Link className="underline" href={`/admin/clerks/${pro.userId}`}>{pro.name ?? 'Unnamed Pro'}</Link>
            </b>
          </div>
          <div className="line"><span>Verification</span><b>{(pro.verification ?? 'unverified').replace(/_/g, ' ')}</b></div>
          <div className="line"><span>Level</span><b>Level {pro.level} · {pro.completed} jobs{pro.rating ? ` · ${pro.rating.toFixed(1)} rating` : ''}</b></div>
          <div className="line"><span>Pro earns</span><b>£{(netP / 100).toFixed(2)}</b></div>
        </div>
      )}
      {declining ? (
        <div className="grid gap-2">
          <Input aria-label="Reason, sent to the Pro" placeholder="Reason (the Pro sees this)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="flex flex-wrap gap-2">
            <button type="button" className="ld-btn ld-btn-primary ld-btn-sm" disabled={busy || reason.trim().length < 3} onClick={() => decide({ action: 'decline', reason }, 'Declined. The job is back on the board.')}>
              Decline and re-list
            </button>
            <button type="button" className="ld-btn ld-btn-secondary ld-btn-sm" onClick={() => setDeclining(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button type="button" className="ld-btn ld-btn-primary" disabled={busy} onClick={() => decide({ action: 'approve' }, 'Approved. The brief is on its way to the Pro.')}>
            Approve and send brief
          </button>
          <button type="button" className="ld-btn ld-btn-secondary" disabled={busy} onClick={() => setDeclining(true)}>
            Decline
          </button>
        </div>
      )}
    </div>
  )
}
