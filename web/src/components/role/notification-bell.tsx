'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Bell, Loader2 } from 'lucide-react'

type NotificationRow = {
  id: string
  type: string
  title: string
  message: string
  link: string | null
  read: boolean
  createdAt: string
}

type Props = {
  /** Initial unread count from the server-rendered layout. The popover
   *  updates this optimistically as the user opens it / clicks rows. */
  unreadCount: number
  /** Optional "View all" link target. `null` hides the footer link. */
  viewAllHref?: string | null
}

const CAP = 9
const PAGE_LIMIT = 20

/**
 * Top-bar notification bell with inline popover. Click to fetch the
 * caller's most recent notifications, optimistically mark them as read,
 * and offer a per-row click-through to the linked surface (`row.link`).
 *
 * Per-row click marks just that row read and navigates; opening the
 * popover marks every currently-unread row read (mirrors the iOS-style
 * "I've seen them" UX). The full management page at `viewAllHref` is
 * opt-in — admin gets it, recipient roles don't need it yet.
 */
export function NotificationBell({ unreadCount, viewAllHref = null }: Props) {
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<NotificationRow[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Optimistic override of the server-supplied count. Tagged with the
  // `unreadCount` value it was based on — once the prop changes (e.g.
  // a new notification arrives and the layout re-renders), the override
  // is considered stale and we fall back to the fresh prop value. This
  // dodges the setState-in-effect lint rule and handles "new
  // notifications mid-session" correctly.
  const [override, setOverride] = useState<{
    basedOn: number
    value: number
  } | null>(null)
  const localUnread =
    override && override.basedOn === unreadCount ? override.value : unreadCount
  const containerRef = useRef<HTMLDivElement | null>(null)

  // Click-outside to close.
  useEffect(() => {
    if (!open) return
    function handler(ev: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(ev.target as Node)
      ) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // Escape to close.
  useEffect(() => {
    if (!open) return
    function handler(ev: KeyboardEvent) {
      if (ev.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/notifications?limit=${PAGE_LIMIT}`, {
        cache: 'no-store',
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = (await res.json()) as { rows: NotificationRow[] }
      setRows(json.rows)
      // Mark every unread row read in the background — best-effort, we
      // optimistically drop the badge immediately.
      const unreadIds = json.rows.filter((r) => !r.read).map((r) => r.id)
      if (unreadIds.length > 0) {
        setOverride({ basedOn: unreadCount, value: 0 })
        void fetch('/api/notifications', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ids: 'all' }),
        }).catch(() => {
          // If the PATCH fails, the badge will re-sync on next nav.
        })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }

  function toggle() {
    setOpen((wasOpen) => {
      if (!wasOpen) {
        void load()
      }
      return !wasOpen
    })
  }

  const label =
    localUnread === 0
      ? 'Notifications'
      : `Notifications : ${localUnread} unread`

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-label={label}
        aria-expanded={open}
        title={label}
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <Bell className="h-4 w-4" />
        {localUnread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-none text-destructive-foreground">
            {localUnread > CAP ? `${CAP}+` : localUnread}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Notifications"
          className="absolute right-0 top-full z-50 mt-2 w-80 origin-top-right overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-lg"
        >
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <h3 className="text-sm font-semibold">Notifications</h3>
            {loading && (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
            )}
          </div>

          <div className="max-h-96 overflow-y-auto">
            {error ? (
              <p className="px-3 py-6 text-center text-xs text-destructive">
                {error}
              </p>
            ) : rows === null && loading ? (
              <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                Loading…
              </p>
            ) : rows && rows.length === 0 ? (
              <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                You&rsquo;re all caught up.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {(rows ?? []).map((r) => (
                  <NotificationRowView
                    key={r.id}
                    row={r}
                    onClick={() => setOpen(false)}
                  />
                ))}
              </ul>
            )}
          </div>

          {viewAllHref && (
            <Link
              href={viewAllHref}
              onClick={() => setOpen(false)}
              className="block border-t border-border px-3 py-2 text-center text-xs text-primary hover:bg-muted"
            >
              View all notifications
            </Link>
          )}
        </div>
      )}
    </div>
  )
}

function NotificationRowView({
  row,
  onClick,
}: {
  row: NotificationRow
  onClick: () => void
}) {
  const body = (
    <div className="flex items-start gap-2 px-3 py-2.5">
      <span
        className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${
          row.read ? 'bg-transparent' : 'bg-primary'
        }`}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-foreground">
          {row.title}
        </p>
        <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">
          {row.message}
        </p>
        <p className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">
          {formatRelative(row.createdAt)}
        </p>
      </div>
    </div>
  )

  if (row.link) {
    return (
      <li>
        <Link
          href={row.link}
          onClick={onClick}
          className="block transition-colors hover:bg-muted/40"
        >
          {body}
        </Link>
      </li>
    )
  }
  return (
    <li className="cursor-default" onClick={onClick}>
      {body}
    </li>
  )
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return ''
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000))
  if (seconds < 60) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
  })
}
