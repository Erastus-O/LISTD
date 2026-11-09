'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'
import type { ProRole } from '@/lib/listd/pricing'

export type RoleSummary = {
  role: ProRole
  label: string
  level: number
  standardsLabel: string
  standardsPassed: boolean
  completed: number
  rating: number | null
  blockers: string[]
  pendingToLevel: number | null
}

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

function LevelBar({ level, text }: { level: number; text: string }) {
  return (
    <span className="ld-level">
      <span aria-hidden="true">
        {[1, 2, 3].map((n) => (
          <i key={n} className={n <= level ? 'on' : ''} />
        ))}
      </span>
      {text}
    </span>
  )
}

/** A Pro's roles and levels, with the route to the next one. */
export function ProLevelsCard({ roles }: { roles: RoleSummary[] }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  async function apply(role: ProRole, toLevel: number) {
    setBusy(true)
    try {
      await post('/api/pro/levels/apply', { role, toLevel })
      toast.success('Application sent to LISTD')
      router.refresh()
    } catch (err) {
      toast.error('Not sent', { description: err instanceof Error ? err.message : undefined })
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="grid gap-3">
      {roles.map((r) => (
        <div key={r.role} className="a-card grid gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <LevelBar level={r.level} text={`${r.label} · Level ${r.level}`} />
            {!r.standardsPassed && <span className="ld-badge ld-badge-info">New to LISTD</span>}
          </div>
          <p className="a-fine">
            {r.completed} completed {r.completed === 1 ? 'job' : 'jobs'} in this role{r.rating != null ? ` · ${r.rating.toFixed(1)} rating` : ''} · {r.standardsLabel}
          </p>
          {r.level < 3 &&
            (r.pendingToLevel ? (
              <p className="text-sm">Your application for Level {r.pendingToLevel} is with LISTD.</p>
            ) : r.blockers.length ? (
              <div className="text-sm">
                <p className="font-semibold">To reach Level {r.level + 1}</p>
                <ul className="a-muted mt-1 list-disc pl-5">
                  {r.blockers.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <div>
                <button type="button" className="ld-btn ld-btn-primary ld-btn-sm" disabled={busy} onClick={() => apply(r.role, r.level + 1)}>
                  Apply for Level {r.level + 1}
                </button>
              </div>
            ))}
        </div>
      ))}
    </div>
  )
}

/** Admin controls on a Pro: set a level, pass the standards check, decide applications. */
export function AdminProLevelsPanel({
  userId,
  roles,
  applications,
}: {
  userId: string
  roles: RoleSummary[]
  applications: Array<{ id: string; role: ProRole; label: string; toLevel: number; note: string | null }>
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [reason, setReason] = useState('')
  async function act(body: unknown, done: string) {
    if (reason.trim().length < 3) {
      toast.error('Give a reason first. It goes in the audit log.')
      return
    }
    setBusy(true)
    try {
      await post('/api/admin/pro-levels', body)
      toast.success(done)
      setReason('')
      router.refresh()
    } catch (err) {
      toast.error('Not saved', { description: err instanceof Error ? err.message : undefined })
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="a-card grid gap-4">
      <h2 className="text-base font-semibold">Roles and levels</h2>
      <Input aria-label="Reason" placeholder="Reason (required, e.g. ten years’ experience, portfolio checked)" value={reason} onChange={(e) => setReason(e.target.value)} />
      {applications.map((a) => (
        <div key={a.id} className="ld-alert ld-alert-info">
          <div>
            <b>{a.label}: applied for Level {a.toLevel}</b>
            {a.note && <p>{a.note}</p>}
            <div className="mt-2 flex gap-2">
              <button type="button" className="ld-btn ld-btn-primary ld-btn-sm" disabled={busy} onClick={() => act({ action: 'decide', applicationId: a.id, approve: true, reason }, 'Approved')}>Approve</button>
              <button type="button" className="ld-btn ld-btn-secondary ld-btn-sm" disabled={busy} onClick={() => act({ action: 'decide', applicationId: a.id, approve: false, reason }, 'Declined')}>Decline</button>
            </div>
          </div>
          <span />
        </div>
      ))}
      {roles.map((r) => (
        <div key={r.role} className="grid gap-2 border-t border-border pt-3">
          <LevelBar level={r.level} text={`${r.label} · Level ${r.level}`} />
          <p className="a-fine">{r.completed} jobs{r.rating != null ? ` · ${r.rating.toFixed(1)} rating` : ''} · {r.standardsLabel}</p>
          <div className="flex flex-wrap gap-2">
            {[1, 2, 3].filter((n) => n !== r.level).map((n) => (
              <button key={n} type="button" className="ld-btn ld-btn-secondary ld-btn-sm" disabled={busy} onClick={() => act({ action: 'set', userId, role: r.role, level: n, reason }, `Set to Level ${n}`)}>
                Set Level {n}
              </button>
            ))}
            {!r.standardsPassed && (
              <button type="button" className="ld-btn ld-btn-ghost ld-btn-sm" disabled={busy} onClick={() => act({ action: 'pass_standards', userId, role: r.role, reason }, 'Standards check passed')}>
                Pass standards check early
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

export type TrainingRow = { id: string; title: string; description: string | null; kind: string; url: string; roleLabel: string | null; level: number; minutes: number | null; done: boolean }

/** A Pro's training list. */
export function TrainingList({ items }: { items: TrainingRow[] }) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  async function complete(id: string) {
    setBusy(id)
    try {
      await post(`/api/pro/trainings/${id}/complete`)
      toast.success('Marked as complete')
      router.refresh()
    } catch (err) {
      toast.error('Not saved', { description: err instanceof Error ? err.message : undefined })
    } finally {
      setBusy(null)
    }
  }
  if (!items.length) {
    return (
      <div className="a-empty">
        <h3>No training yet</h3>
        <p>LISTD will publish training here for your roles.</p>
      </div>
    )
  }
  return (
    <div className="grid gap-3">
      {items.map((t) => (
        <div key={t.id} className="a-card grid gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3>{t.title}</h3>
            {t.done ? (
              <span className="ld-badge ld-badge-success">Completed</span>
            ) : t.level > 0 ? (
              <span className="ld-badge ld-badge-warning">Required for Level {t.level}</span>
            ) : (
              <span className="ld-badge">Optional</span>
            )}
          </div>
          {t.description && <p className="a-muted text-sm">{t.description}</p>}
          <p className="a-fine">{[t.roleLabel, t.minutes ? `${t.minutes} minutes` : null].filter(Boolean).join(' · ')}</p>
          <div className="flex flex-wrap gap-3">
            <a className="ld-btn ld-btn-secondary ld-btn-sm" href={t.url} target="_blank" rel="noopener noreferrer">
              Open {t.kind === 'pdf' ? 'PDF' : t.kind === 'video' ? 'video' : 'link'}
            </a>
            {!t.done && (
              <button type="button" className="ld-btn ld-btn-primary ld-btn-sm" disabled={busy === t.id} onClick={() => complete(t.id)}>
                I’ve finished this
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

/** Trades: finish a repair. */
export function RepairCompletePanel({ jobId }: { jobId: string }) {
  const router = useRouter()
  const [notes, setNotes] = useState('')
  const [extra, setExtra] = useState('')
  const [estimate, setEstimate] = useState('')
  const [busy, setBusy] = useState(false)
  async function run(fn: () => Promise<unknown>, done: string, reset: () => void) {
    setBusy(true)
    try {
      await fn()
      toast.success(done)
      reset()
      router.refresh()
    } catch (err) {
      toast.error('Not sent', { description: err instanceof Error ? err.message : undefined })
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="a-card grid gap-4">
      <h2 className="text-base font-semibold">Repair report</h2>
      <div className="grid gap-2">
        <label className="text-sm font-medium" htmlFor="repair-notes">What did you find and do?</label>
        <textarea id="repair-notes" rows={4} className="w-full rounded-md border border-input bg-transparent p-3 text-sm" value={notes} onChange={(e) => setNotes(e.target.value)} />
        <div>
          <button type="button" className="ld-btn ld-btn-primary" disabled={busy || notes.trim().length < 3} onClick={() => run(() => post(`/api/clerk/jobs/${jobId}/complete-repair`, { notes }), 'Sent to LISTD for review', () => setNotes(''))}>
            Submit repair report
          </button>
        </div>
      </div>
      <div className="grid gap-2 border-t border-border pt-4">
        <label className="text-sm font-medium" htmlFor="extra">Found extra work? It needs the client’s approval before you start.</label>
        <input id="extra" className="h-10 w-full rounded-md border border-input bg-transparent px-3 text-sm" placeholder="What’s needed" value={extra} onChange={(e) => setExtra(e.target.value)} />
        <input aria-label="Your estimate in pounds" className="h-10 max-w-40 rounded-md border border-input bg-transparent px-3 text-sm" inputMode="decimal" placeholder="Estimate £" value={estimate} onChange={(e) => setEstimate(e.target.value)} />
        <div>
          <button
            type="button"
            className="ld-btn ld-btn-secondary"
            disabled={busy || extra.trim().length < 3}
            onClick={() => run(() => post('/api/pro/change-orders', { jobId, description: extra, estimateP: estimate ? Math.round(Number(estimate) * 100) : undefined }), 'Sent to LISTD to price', () => { setExtra(''); setEstimate('') })}
          >
            Propose extra work
          </button>
        </div>
      </div>
    </div>
  )
}
