'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Menu } from 'lucide-react'
import { IdleTimeout } from '@/components/auth/idle-timeout'
import { NotificationBell } from './notification-bell'
import { UserPill } from './user-pill'

type Props = {
  /** Sidebar + top-bar brand label, e.g. "LISTD Pro — Admin". */
  brand: string
  /** Where the brand link goes (typically the role's dashboard). */
  brandHref: string
  /** Pre-built sidebar nav. */
  nav: React.ReactNode
  /** Session bits for the user pill. */
  userEmail: string | null
  userName: string | null
  /** Public URL of the user's profile photo, or null when not set. */
  userAvatarUrl: string | null
  /** Unread notifications count for the top-bar bell. */
  unreadCount: number
  /** Where the bell click navigates. Pass null when the role's notifications
   *  page doesn't exist yet — the bell still shows the count badge. */
  notificationsHref: string | null
  children: React.ReactNode
}

/**
 * Shared shell for the authenticated role dashboards: the prototype's top bar
 * (logo + role tag, notifications, user) over a sticky side nav. On phones the
 * nav opens as a drawer from the top-bar menu button.
 *
 * The tenant portal deliberately does *not* use this shell: it's a token-based
 * public surface with its own narrower tab-nav.
 */
export function RoleLayoutShell({
  brand,
  brandHref,
  nav,
  userEmail,
  userName,
  userAvatarUrl,
  unreadCount,
  notificationsHref,
  children,
}: Props) {
  const [mobileOpen, setMobileOpen] = useState(false)
  // "LISTD Pro : Admin" -> "Admin"; the Pro shell passes just "LISTD Pro".
  const tag = brand.split(':')[1]?.trim() ?? 'Pro'

  return (
    <div className="flex min-h-screen w-full flex-col">
      <IdleTimeout />
      <header className="a-top">
        <div className="in">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
            className="a-bell lg:hidden"
          >
            <Menu className="h-5 w-5" aria-hidden />
          </button>
          <Link href={brandHref} className="ld-logo no-underline" aria-label="listd home">
            listd
          </Link>
          <span className="tag">{tag}</span>
          <span className="ml-auto" />
          <NotificationBell unreadCount={unreadCount} viewAllHref={notificationsHref} />
          <UserPill email={userEmail} name={userName} avatarUrl={userAvatarUrl} />
        </div>
      </header>

      {/* Mobile drawer. Tapping the backdrop or any nav link closes it. */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setMobileOpen(false)}
            className="absolute inset-0 bg-black/50"
          />
          <aside
            onClick={() => setMobileOpen(false)}
            className="absolute inset-y-0 left-0 w-64 max-w-[80%] overflow-y-auto border-r border-border bg-(--side) p-3 shadow-xl"
          >
            <Who name={userName} email={userEmail} tag={tag} />
            {nav}
          </aside>
        </div>
      )}

      <div className="a-shell flex-1">
        <aside className="a-side" aria-label="Sections">
          <Who name={userName} email={userEmail} tag={tag} />
          {nav}
        </aside>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  )
}

function Who({
  name,
  email,
  tag,
}: {
  name: string | null
  email: string | null
  tag: string
}) {
  return (
    <div className="who">
      <b className="truncate">{name || email || 'Your account'}</b>
      <span>{tag}</span>
    </div>
  )
}
