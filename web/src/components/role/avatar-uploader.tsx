'use client'

import { useRef, useState } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { Camera, Loader2, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { createClient } from '@/lib/supabase/client'

const MAX_BYTES = 4 * 1024 * 1024 // 4 MB
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp']

type Props = {
  userId: string
  /** Current avatar URL (initial render). */
  initialAvatarUrl: string | null
  /** Display name — used for the alt text + initials fallback. */
  displayName: string | null
}

/**
 * Reusable profile-photo uploader for the settings pages (admin / clerk /
 * client). Browser-direct upload to `avatars/<userId>/<ts>.<ext>` — Vercel
 * never proxies the bytes. Once the upload lands we POST the URL to
 * [/api/account/avatar](../../app/api/account/avatar/route.ts) which commits
 * `profiles.avatar_url`, then `router.refresh()` so the top-bar
 * `<UserPill>` re-renders with the new photo.
 *
 * Storage RLS in `sql/avatars_bucket.sql` scopes writes to
 * `(storage.foldername(name))[1] = auth.uid()::text`, so this only succeeds
 * for the signed-in user's own folder — we don't need a server-side
 * upload broker.
 */
export function AvatarUploader({
  userId,
  initialAvatarUrl,
  displayName,
}: Props) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [url, setUrl] = useState<string | null>(initialAvatarUrl)
  const [pending, setPending] = useState(false)

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || pending) return

    if (!ACCEPTED_TYPES.includes(file.type)) {
      toast.error('JPG, PNG or WebP only')
      return
    }
    if (file.size > MAX_BYTES) {
      toast.error('Image must be under 4 MB')
      return
    }

    setPending(true)
    try {
      const supabase = createClient()
      const ext = file.type.split('/')[1] ?? 'jpg'
      const path = `${userId}/avatar-${Date.now()}.${ext}`
      const upload = await supabase.storage
        .from('avatars')
        .upload(path, file, {
          contentType: file.type,
          upsert: false,
        })
      if (upload.error) throw new Error(upload.error.message)

      const { data: pub } = supabase.storage
        .from('avatars')
        .getPublicUrl(path)
      const newUrl = pub.publicUrl

      const res = await fetch('/api/account/avatar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ avatarUrl: newUrl }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error ?? `HTTP ${res.status}`)
      }
      setUrl(newUrl)
      toast.success('Photo updated')
      router.refresh()
    } catch (err) {
      toast.error('Could not upload photo', {
        description: err instanceof Error ? err.message : 'Please try again.',
      })
    } finally {
      setPending(false)
    }
  }

  async function handleRemove() {
    if (pending || !url) return
    setPending(true)
    try {
      const res = await fetch('/api/account/avatar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ avatarUrl: null }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error ?? `HTTP ${res.status}`)
      }
      setUrl(null)
      toast.success('Photo removed')
      router.refresh()
    } catch (err) {
      toast.error('Could not remove photo', {
        description: err instanceof Error ? err.message : 'Please try again.',
      })
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex items-center gap-4">
      <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-full bg-primary text-sm font-semibold text-primary-foreground">
        {url ? (
          <Image
            src={url}
            alt={displayName ?? 'Profile photo'}
            fill
            sizes="64px"
            className="object-cover"
            unoptimized
          />
        ) : (
          <span className="flex h-full w-full items-center justify-center">
            {initials(displayName)}
          </span>
        )}
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => inputRef.current?.click()}
          disabled={pending}
          className="gap-1.5"
        >
          {pending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Camera className="h-3.5 w-3.5" />
          )}
          {url ? 'Change photo' : 'Upload photo'}
        </Button>
        {url && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={handleRemove}
            disabled={pending}
            className="gap-1.5 text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Remove
          </Button>
        )}
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

function initials(name: string | null): string {
  const trimmed = (name ?? '').trim()
  if (!trimmed) return '?'
  const parts = trimmed.split(/\s+/).filter(Boolean)
  const first = parts[0]?.[0] ?? ''
  const last = parts.length > 1 ? parts[parts.length - 1][0] : ''
  return (first + last).toUpperCase() || '?'
}
