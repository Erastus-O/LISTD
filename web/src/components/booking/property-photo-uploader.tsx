'use client'

import { useEffect, useRef, useState } from 'react'
import { Camera, ImageIcon, Loader2, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { createClient } from '@/lib/supabase/client'

const MAX_BYTES = 8 * 1024 * 1024 // 8 MB — phone camera originals are big
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp']

type Props = {
  /** Stored URL (public-form) of the current photo, or null. */
  value: string | null
  onChange: (url: string | null) => void
  disabled?: boolean
}

/**
 * Optional property photo, collected in the booking property form and
 * shown as the thumbnail on every job card a Pro browses.
 *
 * Browser-direct upload to `property-photos/<userId>/<ts>.<ext>`, matching
 * the avatar uploader — bytes never transit Vercel. The bucket is PRIVATE
 * (0039), so the public-form URL we hand back is a storage *address*, not
 * a readable link: the job feeds re-sign it server-side before render.
 * That also means the in-form preview can't load from the returned URL, so
 * we hold a local `objectURL` for the session instead.
 */
export function PropertyPhotoUploader({ value, onChange, disabled }: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [pending, setPending] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  // Revoke the object URL when it's replaced or the form unmounts —
  // otherwise a client cycling through photos leaks each blob.
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || pending || disabled) return

    if (!ACCEPTED_TYPES.includes(file.type)) {
      toast.error('JPG, PNG or WebP only')
      return
    }
    if (file.size > MAX_BYTES) {
      toast.error('Photo must be under 8 MB')
      return
    }

    setPending(true)
    try {
      const supabase = createClient()
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser()
      if (authError || !user) throw new Error('Sign in again to upload a photo')

      const ext = file.type.split('/')[1] ?? 'jpg'
      const path = `${user.id}/property-${Date.now()}.${ext}`
      const upload = await supabase.storage
        .from('property-photos')
        .upload(path, file, { contentType: file.type, upsert: false })
      if (upload.error) throw new Error(upload.error.message)

      const { data: pub } = supabase.storage
        .from('property-photos')
        .getPublicUrl(path)

      setPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev)
        return URL.createObjectURL(file)
      })
      onChange(pub.publicUrl)
      toast.success('Photo added')
    } catch (err) {
      toast.error('Could not upload photo', {
        description: err instanceof Error ? err.message : 'Please try again.',
      })
    } finally {
      setPending(false)
    }
  }

  function handleRemove() {
    if (pending || disabled) return
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return null
    })
    onChange(null)
  }

  const hasPhoto = Boolean(value)

  return (
    <div className="flex items-center gap-3">
      <div className="relative flex h-16 w-24 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted">
        {previewUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element -- local object URL, never a remote fetch */
          <img
            src={previewUrl}
            alt="Property"
            className="h-full w-full object-cover"
          />
        ) : hasPhoto ? (
          <span className="px-1 text-center text-[10px] text-muted-foreground">
            Photo saved
          </span>
        ) : (
          <ImageIcon className="h-5 w-5 text-muted-foreground/50" />
        )}
      </div>
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => inputRef.current?.click()}
            disabled={pending || disabled}
            className="gap-1.5"
          >
            {pending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Camera className="h-3.5 w-3.5" />
            )}
            {hasPhoto ? 'Change photo' : 'Add photo'}
          </Button>
          {hasPhoto && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={handleRemove}
              disabled={pending || disabled}
              className="gap-1.5 text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Remove
            </Button>
          )}
        </div>
        <p className="text-[10px] text-muted-foreground">
          Optional. Shown to Pros on the job listing so they recognise the
          building on arrival.
        </p>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={handleFile}
          className="hidden"
        />
      </div>
    </div>
  )
}
