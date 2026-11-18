'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

type Workflow = { autoApproveFromLevel: number; clientChat: boolean; platformRules: string }

/** Admin › Settings: how accepted jobs are approved, client chat, platform rules. */
export function ProWorkflowForm({ initial }: { initial: Workflow }) {
  const [w, setW] = useState(initial)
  const [busy, setBusy] = useState(false)

  async function save() {
    setBusy(true)
    try {
      const res = await fetch('/api/admin/pro-workflow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(w),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`)
      toast.success('Saved. Applies to the next job a Pro accepts.')
    } catch (err) {
      toast.error('Not saved', { description: err instanceof Error ? err.message : undefined })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section id="pro-jobs" className="a-card grid gap-4">
      <div>
        <h2 className="text-base font-semibold">Pro jobs</h2>
        <p className="a-muted mt-1 text-sm">How accepted jobs are approved, who can message LISTD, and the rules sent with every brief.</p>
      </div>
      <div className="grid gap-1.5 sm:max-w-sm">
        <Label htmlFor="auto-approve">Approving accepted jobs</Label>
        <select
          id="auto-approve"
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          value={w.autoApproveFromLevel}
          onChange={(e) => setW({ ...w, autoApproveFromLevel: Number(e.target.value) })}
        >
          <option value={0}>LISTD approves every job by hand</option>
          <option value={1}>Auto-approve every verified Pro</option>
          <option value={2}>Auto-approve from Level 2</option>
          <option value={3}>Auto-approve from Level 3</option>
        </select>
      </div>
      <label className="flex items-center gap-3 text-sm">
        <input type="checkbox" className="h-4 w-4 accent-primary" checked={w.clientChat} onChange={(e) => setW({ ...w, clientChat: e.target.checked })} />
        Clients can message LISTD on their booking (Pros never message clients directly)
      </label>
      <div className="grid gap-1.5">
        <Label htmlFor="rules">Platform rules, one per line. Sent with every job brief.</Label>
        <Textarea id="rules" rows={6} value={w.platformRules} onChange={(e) => setW({ ...w, platformRules: e.target.value })} />
      </div>
      <div>
        <button type="button" className="ld-btn ld-btn-primary" disabled={busy || !w.platformRules.trim()} onClick={save}>
          {busy ? 'Saving...' : 'Save Pro job settings'}
        </button>
      </div>
    </section>
  )
}
