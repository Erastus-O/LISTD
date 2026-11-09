'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type Row = { id: string; title: string; description: string | null; kind: string; url: string; role: string | null; level: number; minutes: number | null; status: string }

const EMPTY = { title: '', description: '', kind: 'link', url: '', role: 'CLERK', level: 0, status: 'PUBLISHED' }
const SELECT = 'mt-1.5 h-10 w-full rounded-md border border-input bg-transparent px-3 text-sm'

export function TrainingAdmin({ rows }: { rows: Row[] }) {
  const router = useRouter()
  const [f, setF] = useState(EMPTY)
  const [busy, setBusy] = useState(false)

  async function save(body: unknown, done: string) {
    setBusy(true)
    try {
      const res = await fetch('/api/admin/trainings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`)
      toast.success(done)
      setF(EMPTY)
      router.refresh()
    } catch (err) {
      toast.error('Not saved', { description: err instanceof Error ? err.message : undefined })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="w-full px-4 py-8 sm:px-6 sm:py-10">
      <div className="a-page">
        <div className="a-head">
          <div>
            <h1>Training</h1>
            <p>Required training blocks a level until it’s done, and has no override.</p>
          </div>
        </div>
        <form
          className="a-card grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            save({ ...f, role: f.role || null }, 'Training saved')
          }}
        >
          <h2 className="text-base font-semibold">Add training</h2>
          <div>
            <Label htmlFor="t-title">Title</Label>
            <Input id="t-title" className="mt-1.5" required value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="t-url">Link (https)</Label>
            <Input id="t-url" className="mt-1.5" type="url" required value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <Label htmlFor="t-kind">Type</Label>
              <select id="t-kind" className={SELECT} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
                <option value="link">Link</option>
                <option value="video">Video</option>
                <option value="pdf">PDF</option>
              </select>
            </div>
            <div>
              <Label htmlFor="t-role">Role</Label>
              <select id="t-role" className={SELECT} value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
                <option value="CLERK">Pro Clerk</option>
                <option value="CLEANER">Pro Cleaner</option>
                <option value="TRADES">Pro Trades</option>
              </select>
            </div>
            <div>
              <Label htmlFor="t-level">Required for</Label>
              <select id="t-level" className={SELECT} value={f.level} onChange={(e) => setF({ ...f, level: Number(e.target.value) })}>
                <option value={0}>Optional</option>
                <option value={1}>Level 1</option>
                <option value={2}>Level 2</option>
                <option value={3}>Level 3</option>
              </select>
            </div>
          </div>
          <div>
            <button type="submit" className="ld-btn ld-btn-primary" disabled={busy}>Publish</button>
          </div>
        </form>
        <div className="a-sec">
          {rows.map((t) => (
            <div key={t.id} className="a-card flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3>{t.title}</h3>
                <p className="a-fine">{t.status} · {t.role ?? 'All roles'} · {t.level ? `Required for Level ${t.level}` : 'Optional'}</p>
              </div>
              {t.status !== 'ARCHIVED' && (
                <button
                  type="button"
                  className="ld-btn ld-btn-secondary ld-btn-sm"
                  disabled={busy}
                  onClick={() => save({ id: t.id, title: t.title, kind: t.kind, url: t.url, role: t.role, level: t.level, status: 'ARCHIVED' }, 'Archived')}
                >
                  Archive
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
