'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Camera, Check, CheckCircle2, Clock, Loader2, Play, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { createClient } from '@/lib/supabase/client'
import type { CleanerCompletion } from '@/lib/dashboard/cleaner-jobs'

type Props = {
  jobId: string
  status: string
  tasks: string[]
  completion: CleanerCompletion | null
}

export function CleanerJobActions({ jobId, status, tasks, completion }: Props) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [checked, setChecked] = useState<Set<number>>(new Set())
  const [notes, setNotes] = useState('')
  const [photos, setPhotos] = useState<string[]>([])
  const [uploading, setUploading] = useState(false)

  // ── Completed / paid: read-only summary ──────────────────────────────────
  if (status === 'completed' || status === 'paid') {
    return (
      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="space-y-3 p-6">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-primary" />
            <h2 className="text-base font-semibold">Clean completed</h2>
          </div>
          <ul className="space-y-1.5">
            {tasks.map((t, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-foreground">
                <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                <span>{t}</span>
              </li>
            ))}
          </ul>
          {completion?.notes && (
            <div className="rounded-lg border border-border bg-background p-3">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Notes
              </p>
              <p className="mt-1 whitespace-pre-line text-sm">{completion.notes}</p>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            {completion?.photos.length ?? 0}{' '}
            {(completion?.photos.length ?? 0) === 1 ? 'photo' : 'photos'} attached
            {completion?.completedAt
              ? ` · completed ${new Date(completion.completedAt).toLocaleString('en-GB')}`
              : ''}
            .
          </p>
        </CardContent>
      </Card>
    )
  }

  // ── Submitted: work done, awaiting admin sign-off ─────────────────────────
  if (status === 'submitted') {
    return (
      <Card className="border-amber-300 bg-amber-50">
        <CardContent className="space-y-3 p-6">
          <div className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-amber-600" />
            <h2 className="text-base font-semibold">Submitted for review</h2>
          </div>
          <p className="text-sm text-muted-foreground">
            Your completed clean is awaiting admin sign-off. You&rsquo;ll be paid
            to your connected account once it&rsquo;s approved.
          </p>
          {completion?.notes && (
            <div className="rounded-lg border border-border bg-background p-3">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Notes
              </p>
              <p className="mt-1 whitespace-pre-line text-sm">
                {completion.notes}
              </p>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            {completion?.photos.length ?? 0}{' '}
            {(completion?.photos.length ?? 0) === 1 ? 'photo' : 'photos'} attached.
          </p>
        </CardContent>
      </Card>
    )
  }

  // ── Accepted: start the clean ─────────────────────────────────────────────
  async function start() {
    if (pending) return
    setPending(true)
    try {
      const res = await fetch(`/api/cleaner/jobs/${jobId}/start`, { method: 'POST' })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error ?? `HTTP ${res.status}`)
      }
      toast.success('Clean started')
      router.refresh()
    } catch (err) {
      toast.error('Could not start', {
        description: err instanceof Error ? err.message : 'Please try again.',
      })
      setPending(false)
    }
  }

  if (status === 'accepted') {
    return (
      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="flex items-center justify-between gap-3 p-5">
          <div>
            <p className="text-sm font-medium text-foreground">
              Ready to start the clean?
            </p>
            <p className="text-xs text-muted-foreground">
              Mark it started when you&rsquo;re on site, then work through the
              checklist.
            </p>
          </div>
          <Button onClick={start} disabled={pending} className="gap-1.5">
            {pending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Play className="h-4 w-4" />
            )}
            Start clean
          </Button>
        </CardContent>
      </Card>
    )
  }

  // ── In progress: checklist + photos + complete ────────────────────────────
  function toggle(i: number) {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }

  async function uploadPhoto(file: File) {
    if (file.size > 12 * 1024 * 1024) {
      toast.error('File too large', { description: 'Max 12 MB.' })
      return
    }
    setUploading(true)
    try {
      const supabase = createClient()
      const ext = file.name.split('.').pop() ?? 'jpg'
      const path = `${jobId}/clean_${Date.now()}.${ext}`
      const { error } = await supabase.storage
        .from('job-photos')
        .upload(path, file, { upsert: true, contentType: file.type })
      if (error) throw error
      setPhotos((p) => [...p, path])
    } catch (err) {
      toast.error('Upload failed', {
        description: err instanceof Error ? err.message : 'Please try again.',
      })
    } finally {
      setUploading(false)
    }
  }

  const allChecked = checked.size >= tasks.length

  async function complete() {
    if (pending || !allChecked) return
    setPending(true)
    try {
      const res = await fetch(`/api/cleaner/jobs/${jobId}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          checkedTasks: Array.from(checked),
          notes: notes.trim() || undefined,
          photos: photos.length > 0 ? photos : undefined,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error ?? `HTTP ${res.status}`)
      }
      toast.success('Clean completed', { description: 'Nice work.' })
      router.refresh()
    } catch (err) {
      toast.error('Could not complete', {
        description: err instanceof Error ? err.message : 'Please try again.',
      })
      setPending(false)
    }
  }

  return (
    <Card>
      <CardContent className="space-y-4 p-6">
        <h2 className="text-base font-semibold">Completion checklist</h2>
        <p className="text-xs text-muted-foreground">
          Tick every task once done. All tasks must be ticked to complete the
          clean.
        </p>
        <ul className="space-y-1">
          {tasks.map((t, i) => {
            const on = checked.has(i)
            return (
              <li key={i}>
                <label className="flex cursor-pointer items-start gap-3 rounded-md p-2 hover:bg-muted/40">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => toggle(i)}
                    className="mt-0.5 h-4 w-4 rounded border-input accent-primary"
                  />
                  <span
                    className={`text-sm ${on ? 'text-muted-foreground line-through' : 'text-foreground'}`}
                  >
                    {t}
                  </span>
                </label>
              </li>
            )
          })}
        </ul>

        <div className="border-t border-border pt-4">
          <p className="mb-2 text-sm font-medium">Photos (optional)</p>
          {photos.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {photos.map((p, i) => (
                <span
                  key={p}
                  className="inline-flex items-center gap-1 rounded-full bg-secondary px-3 py-1 text-xs"
                >
                  Photo {i + 1}
                  <button
                    type="button"
                    onClick={() => setPhotos((ps) => ps.filter((x) => x !== p))}
                    className="text-muted-foreground hover:text-foreground"
                    aria-label="Remove photo"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm hover:bg-muted">
            {uploading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Camera className="h-4 w-4" />
            )}
            <span>{uploading ? 'Uploading…' : 'Add photo'}</span>
            <input
              type="file"
              accept="image/*"
              className="hidden"
              disabled={uploading}
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) uploadPhoto(f)
                e.target.value = ''
              }}
            />
          </label>
        </div>

        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Any notes for the client (e.g. items that needed extra attention)…"
          rows={3}
          maxLength={2000}
        />

        <Button
          onClick={complete}
          disabled={!allChecked || pending || uploading}
          className="w-full gap-1.5"
        >
          {pending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <CheckCircle2 className="h-4 w-4" />
          )}
          {allChecked
            ? 'Complete clean'
            : `Tick all tasks (${checked.size}/${tasks.length})`}
        </Button>
      </CardContent>
    </Card>
  )
}
