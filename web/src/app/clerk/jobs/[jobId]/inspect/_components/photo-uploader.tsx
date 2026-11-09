'use client'

import { useRef, useState } from 'react'
import { Camera, ImagePlus, Loader2, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { createClient } from '@/lib/supabase/client'
import { CameraCapture } from './camera-capture'

const MAX_PHOTO_BYTES = 12 * 1024 * 1024 // 12 MB (phone photos / HEIC can be large)

export type ManagedPhoto = {
  /** Stable client id used for React keys + remove. */
  clientId: string
  /** Public-style URL that gets persisted with the submission. The
   *  `generated-reports` bucket is private (PII / ADR-001) so this URL
   *  isn't directly fetchable; the server signs it on read via
   *  `signStoredAssetUrl` for the PDF + viewer paths. */
  url: string
  /** Storage path (kept so we could delete on remove later). */
  storagePath: string
  /** Short-lived signed URL used **only** for the in-form thumbnail.
   *  We can't use the public URL here — the bucket is private, so the
   *  browser would receive a 401 and `<img>` would silently fail. */
  previewUrl: string
}

type Props = {
  jobId: string
  photos: ManagedPhoto[]
  disabled?: boolean
  label?: string
  max?: number
  onChange: (next: ManagedPhoto[]) => void
}

/**
 * Browser-direct photo uploader. Files go straight from the clerk's device
 * to Supabase storage (`generated-reports/<jobId>/inspection-photos/...`)
 * — Vercel never proxies the bytes, so we don't hit the 4.5 MB function
 * payload cap on a typical 6-photo room.
 *
 * The bucket's RLS policies (Listd-NEXT/sql/generated_reports_bucket.sql)
 * scope INSERT to the assigned clerk's own jobs, so callers don't need
 * extra auth wiring here.
 */
export function PhotoUploader({
  jobId,
  photos,
  disabled,
  label = 'Photos',
  max = 12,
  onChange,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(0)
  const [cameraOpen, setCameraOpen] = useState(false)

  async function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    e.target.value = '' // allow re-uploading the same file
    await uploadFiles(files)
  }

  // Shared upload path for both the file picker and the in-page camera.
  async function uploadFiles(files: File[]) {
    if (files.length === 0) return

    const remaining = Math.max(0, max - photos.length)
    if (remaining === 0) {
      toast.error(`Maximum ${max} photos`)
      return
    }
    const accepted = files.slice(0, remaining)
    if (files.length > remaining) {
      toast.warning(`Only adding ${remaining} of ${files.length} photos`)
    }

    const supabase = createClient()
    setUploading((n) => n + accepted.length)

    const results: ManagedPhoto[] = []
    for (const file of accepted) {
      try {
        if (!file.type.startsWith('image/')) {
          toast.error(`${file.name}: only image files allowed`)
          continue
        }
        if (file.size > MAX_PHOTO_BYTES) {
          toast.error(`${file.name}: must be under 12 MB`)
          continue
        }
        const ext = file.type.split('/')[1] ?? 'jpg'
        const storagePath = `${jobId}/inspection-photos/${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 8)}.${ext}`
        const upload = await supabase.storage
          .from('generated-reports')
          .upload(storagePath, file, {
            contentType: file.type,
            upsert: false,
          })
        if (upload.error) {
          toast.error(`Upload failed: ${upload.error.message}`)
          continue
        }
        // Persistent URL (public-style — the server signs it on read).
        const { data: pub } = supabase.storage
          .from('generated-reports')
          .getPublicUrl(storagePath)
        // Instant in-session thumbnail straight from the captured file — no
        // network round-trip and no dependency on a signed URL succeeding (the
        // bucket is private). Photos restored from a draft after a reload are
        // re-signed on mount via `resignDraftPhotos`.
        const previewUrl = URL.createObjectURL(file)
        results.push({
          clientId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          url: pub.publicUrl,
          storagePath,
          previewUrl,
        })
      } finally {
        setUploading((n) => n - 1)
      }
    }
    if (results.length > 0) {
      onChange([...photos, ...results])
    }
  }

  function removePhoto(clientId: string) {
    const target = photos.find((p) => p.clientId === clientId)
    // Free the in-memory object URL we created for the thumbnail.
    if (target?.previewUrl?.startsWith('blob:')) {
      URL.revokeObjectURL(target.previewUrl)
    }
    onChange(photos.filter((p) => p.clientId !== clientId))
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label className="text-[11px] text-muted-foreground">
          {label} ({photos.length}/{max})
        </Label>
        <div className="flex items-center gap-1">
          {/* Camera: opens the rear camera on a phone; on desktop the browser
              just shows the file picker (capture is ignored). */}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setCameraOpen(true)}
            disabled={disabled || uploading > 0 || photos.length >= max}
            className="h-8 gap-1 px-2 text-[11px]"
          >
            <Camera className="h-3.5 w-3.5" />
            Camera
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => inputRef.current?.click()}
            disabled={disabled || uploading > 0 || photos.length >= max}
            className="h-8 gap-1 px-2 text-[11px]"
          >
            {uploading > 0 ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Uploading…
              </>
            ) : (
              <>
                <ImagePlus className="h-3.5 w-3.5" />
                Add
              </>
            )}
          </Button>
        </div>
      </div>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept="image/*"
        onChange={handleFiles}
        className="hidden"
      />
      {/* In-page camera (getUserMedia) — opens a live preview inside the page
          rather than the native camera app, so the browser can't evict/reload
          the page mid-capture (the `<input capture>` failure mode). */}
      <CameraCapture
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onCapture={(file) => void uploadFiles([file])}
      />
      {photos.length > 0 && (
        <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
          {photos.map((p) => (
            <div
              key={p.clientId}
              className="group relative aspect-square overflow-hidden rounded-md border border-border bg-muted"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- preview is a local blob: URL (in-session) or a signed URL (restored); next/image mishandles blob: sources */}
              <img
                src={p.previewUrl}
                alt=""
                className="absolute inset-0 h-full w-full object-cover"
              />
              {!disabled && (
                <button
                  type="button"
                  onClick={() => removePhoto(p.clientId)}
                  className="absolute right-1 top-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
                  aria-label="Remove photo"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
