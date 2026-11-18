'use client'

import { useRef, useState } from 'react'
import { Camera, Loader2, Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'
import { createClient } from '@/lib/supabase/client'
import type { AreaPhotos } from '@/lib/listd/area-frames'

const MAX_BYTES = 12 * 1024 * 1024

/**
 * One photo frame per area. The Pro removes frames that don't apply, adds
 * missing ones, and needs at least one photo in each frame left. Photos go to
 * the private job-photos bucket under the job.
 */
export function AreaPhotoFrames({
  jobId,
  frames,
  onChange,
  prefix,
}: {
  jobId: string
  frames: AreaPhotos[]
  onChange: (frames: AreaPhotos[]) => void
  prefix: string
}) {
  const [busyArea, setBusyArea] = useState<string | null>(null)
  const [newArea, setNewArea] = useState('')
  const inputs = useRef<Record<string, HTMLInputElement | null>>({})

  async function upload(area: string, files: FileList | null) {
    if (!files?.length) return
    setBusyArea(area)
    const supabase = createClient()
    const added: string[] = []
    for (const file of Array.from(files)) {
      if (file.size > MAX_BYTES) {
        toast.error(`${file.name} is too large (max 12 MB)`)
        continue
      }
      const ext = file.type.split('/')[1] ?? 'jpg'
      const slug = area.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)
      const path = `${jobId}/${prefix}/${slug}_${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
      const { error } = await supabase.storage.from('job-photos').upload(path, file, { contentType: file.type, upsert: false })
      if (error) toast.error(`Upload failed: ${error.message}`)
      else added.push(path)
    }
    onChange(frames.map((f) => (f.area === area ? { ...f, paths: [...f.paths, ...added] } : f)))
    setBusyArea(null)
  }

  function addArea() {
    const area = newArea.trim().slice(0, 80)
    if (!area || frames.some((f) => f.area.toLowerCase() === area.toLowerCase())) return
    onChange([...frames, { area, paths: [] }])
    setNewArea('')
  }

  return (
    <div className="grid gap-3">
      {frames.map((f) => (
        <div key={f.area} className={`rounded-lg border p-3 ${f.paths.length ? 'border-border' : 'border-amber-500/40'}`}>
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium">
              {f.area}{' '}
              <span className="text-xs font-normal text-muted-foreground">
                {f.paths.length ? `${f.paths.length} photo${f.paths.length === 1 ? '' : 's'}` : 'needs a photo'}
              </span>
            </p>
            <button
              type="button"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive"
              onClick={() => onChange(frames.filter((x) => x.area !== f.area))}
              aria-label={`Remove ${f.area}, not part of this job`}
            >
              <X className="h-3.5 w-3.5" /> Not needed
            </button>
          </div>
          {f.paths.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {f.paths.map((p, i) => (
                <li key={p} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-xs">
                  Photo {i + 1}
                  <button type="button" aria-label={`Remove photo ${i + 1} from ${f.area}`} onClick={() => onChange(frames.map((x) => (x.area === f.area ? { ...x, paths: x.paths.filter((y) => y !== p) } : x)))}>
                    <X className="h-3 w-3" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <input
            ref={(el) => {
              inputs.current[f.area] = el
            }}
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            className="hidden"
            onChange={(e) => {
              void upload(f.area, e.target.files)
              e.target.value = ''
            }}
          />
          <button type="button" className="ld-btn ld-btn-secondary ld-btn-sm mt-2 gap-1.5" disabled={busyArea !== null} onClick={() => inputs.current[f.area]?.click()}>
            {busyArea === f.area ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
            Add photo
          </button>
        </div>
      ))}
      <div className="flex gap-2">
        <Input aria-label="Add an area" placeholder="Add an area, e.g. Utility room" value={newArea} maxLength={80} onChange={(e) => setNewArea(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addArea())} />
        <button type="button" className="ld-btn ld-btn-secondary ld-btn-sm gap-1" onClick={addArea} disabled={!newArea.trim()}>
          <Plus className="h-3.5 w-3.5" /> Add
        </button>
      </div>
    </div>
  )
}
