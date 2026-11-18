'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Camera, Loader2, X } from 'lucide-react'
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { createClient } from '@/lib/supabase/client'

const MAX_BYTES = 50 * 1024 * 1024

/**
 * Found extra work on site? The Pro sends photo or video evidence and their
 * estimate. LISTD prices it and the client says yes or no. Until then, the Pro
 * carries on with the job as booked.
 */
export function RequotePanel({ jobId }: { jobId: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [description, setDescription] = useState('')
  const [estimate, setEstimate] = useState('')
  const [files, setFiles] = useState<Array<{ path: string; name: string }>>([])
  const [uploading, setUploading] = useState(false)
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  async function upload(list: FileList | null) {
    if (!list?.length) return
    setUploading(true)
    const supabase = createClient()
    const added: Array<{ path: string; name: string }> = []
    for (const file of Array.from(list)) {
      if (file.size > MAX_BYTES) {
        toast.error(`${file.name} is too large (max 50 MB)`)
        continue
      }
      const ext = file.name.split('.').pop() ?? (file.type.startsWith('video/') ? 'mp4' : 'jpg')
      const path = `${jobId}/requotes/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
      const { error } = await supabase.storage.from('job-photos').upload(path, file, { contentType: file.type, upsert: false })
      if (error) toast.error(`Upload failed: ${error.message}`)
      else added.push({ path, name: file.type.startsWith('video/') ? 'Video' : 'Photo' })
    }
    setFiles((f) => [...f, ...added].slice(0, 10))
    setUploading(false)
  }

  async function send() {
    setBusy(true)
    try {
      const res = await fetch('/api/pro/change-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId,
          description: description.trim(),
          estimateP: estimate ? Math.round(Number(estimate) * 100) : undefined,
          evidencePaths: files.map((f) => f.path),
        }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`)
      toast.success('Sent to LISTD', { description: 'LISTD prices it and asks the client. Carry on with the job as booked until they approve.' })
      setOpen(false)
      setDescription('')
      setEstimate('')
      setFiles([])
      router.refresh()
    } catch (err) {
      toast.error('Not sent', { description: err instanceof Error ? err.message : undefined })
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <div className="a-card flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Found extra work?</h2>
          <p className="a-muted text-sm">Send a requote with photos or a video. The client confirms before you do it.</p>
        </div>
        <button type="button" className="ld-btn ld-btn-secondary" onClick={() => setOpen(true)}>
          Request a requote
        </button>
      </div>
    )
  }

  return (
    <div className="a-card grid gap-3">
      <h2 className="text-base font-semibold">Requote for extra work</h2>
      <Textarea aria-label="What extra work is needed" rows={3} maxLength={2000} placeholder="What is needed and why" value={description} onChange={(e) => setDescription(e.target.value)} />
      <Input aria-label="Your estimate for the extra work, in pounds" className="max-w-48" inputMode="decimal" placeholder="Extra cost £" value={estimate} onChange={(e) => setEstimate(e.target.value)} />
      <div className="grid gap-2">
        {files.length > 0 && (
          <ul className="flex flex-wrap gap-1.5">
            {files.map((f, i) => (
              <li key={f.path} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-xs">
                {f.name} {i + 1}
                <button type="button" aria-label={`Remove ${f.name.toLowerCase()} ${i + 1}`} onClick={() => setFiles((x) => x.filter((y) => y.path !== f.path))}>
                  <X className="h-3 w-3" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <input
          ref={input}
          type="file"
          accept="image/*,video/*"
          multiple
          className="hidden"
          onChange={(e) => {
            void upload(e.target.files)
            e.target.value = ''
          }}
        />
        <div>
          <button type="button" className="ld-btn ld-btn-secondary ld-btn-sm gap-1.5" disabled={uploading} onClick={() => input.current?.click()}>
            {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
            Add photo or video
          </button>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="ld-btn ld-btn-primary" disabled={busy || uploading || description.trim().length < 3 || files.length === 0} onClick={send}>
          {busy ? 'Sending...' : 'Send requote'}
        </button>
        <button type="button" className="ld-btn ld-btn-secondary" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </div>
  )
}
