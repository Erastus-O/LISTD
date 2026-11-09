'use client'

import { useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { ChevronDown, Loader2, LogOut } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'

type Props = {
  email: string | null
  name: string | null
  /** Public URL of the user's profile photo. Renders as <img> when present;
   *  initials fallback when null. */
  avatarUrl: string | null
}

/**
 * Top-bar user pill: avatar (initials) + display name + dropdown caret.
 * Replaces the old inline sign-out button from `<UserMenu>` — every
 * authenticated role layout now surfaces this in the top bar instead of
 * stashing sign-out inside the sidebar.
 *
 * Display rules:
 *   - Avatar shows up to two initials from `name`. Falls back to `email`'s
 *     first letter when no name is on file.
 *   - Label prefers `name` (the full display name); falls back to email.
 *
 * Dropdown is a self-contained popover — built inline rather than dragging
 * in a radix DropdownMenu wrapper for one item. Click-outside + Escape
 * both close it.
 */
export function UserPill({ email, name, avatarUrl }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const wrapperRef = useRef<HTMLDivElement | null>(null)

  // Close on outside click + Escape.
  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  async function handleSignOut() {
    if (pending) return
    setPending(true)
    try {
      const supabase = createClient()
      const { error } = await supabase.auth.signOut()
      if (error) throw error
      router.push('/')
      router.refresh()
    } catch (err) {
      console.error('[user-pill] sign out failed:', err)
      toast.error('Sign out failed', {
        description: err instanceof Error ? err.message : 'Please try again.',
      })
      setPending(false)
    }
  }

  const label = name?.trim() || email?.trim() || 'Account'
  const initials = computeInitials(name, email)

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-full border border-border bg-background px-1.5 py-1 text-sm transition-colors hover:bg-muted"
      >
        <span className="relative inline-flex h-7 w-7 shrink-0 overflow-hidden rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">
          {avatarUrl ? (
            <Image
              src={avatarUrl}
              alt=""
              fill
              sizes="28px"
              className="object-cover"
              unoptimized
            />
          ) : (
            <span className="flex h-full w-full items-center justify-center">
              {initials}
            </span>
          )}
        </span>
        <span className="hidden max-w-[160px] truncate sm:inline">
          {label}
        </span>
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-[calc(100%+6px)] z-50 w-56 overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-md"
        >
          <div className="border-b border-border px-3 py-2">
            <p className="truncate text-sm font-medium">{label}</p>
            {email && name && (
              <p className="truncate text-[11px] text-muted-foreground">
                {email}
              </p>
            )}
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={handleSignOut}
            disabled={pending}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-destructive transition-colors hover:bg-destructive/5 disabled:opacity-60"
          >
            {pending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <LogOut className="h-3.5 w-3.5" />
            )}
            Logout
          </button>
        </div>
      )}
    </div>
  )
}

function computeInitials(
  name: string | null,
  email: string | null
): string {
  const fromName = (name ?? '').trim()
  if (fromName) {
    const parts = fromName.split(/\s+/).filter(Boolean)
    const first = parts[0]?.[0] ?? ''
    const last = parts.length > 1 ? parts[parts.length - 1][0] : ''
    return (first + last).toUpperCase() || '?'
  }
  const fromEmail = (email ?? '').trim()
  if (fromEmail) return fromEmail[0]!.toUpperCase()
  return '?'
}
