'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  GraduationCap,
  BookOpen,
  Briefcase,
  LayoutDashboard,
  PoundSterling,
  Search,
  Settings,
  type LucideIcon,
} from 'lucide-react'

type NavItem = {
  title: string
  href: string
  icon: LucideIcon
  /** Exact-match flag — defaults to "starts-with" so detail pages stay
   *  highlighted under their list parent (e.g. /clerk/jobs/abc highlights
   *  "My Jobs"). */
  exact?: boolean
}

const NAV_ITEMS: NavItem[] = [
  {
    title: 'Dashboard',
    href: '/clerk/dashboard',
    icon: LayoutDashboard,
    exact: true,
  },
  { title: 'Jobs', href: '/clerk/jobs/available', icon: Search },
  // `/clerk/jobs/available` is more specific than `/clerk/jobs`, so list
  // Available first and rely on the longest-match logic in `isActive` below.
  { title: 'Schedule', href: '/clerk/jobs', icon: Briefcase },
  { title: 'Training & level', href: '/clerk/training', icon: GraduationCap },
  { title: 'Earnings', href: '/clerk/earnings', icon: PoundSterling },
  { title: 'Settings', href: '/clerk/settings', icon: Settings },
  { title: 'Help', href: '/help', icon: BookOpen },
]

/**
 * Clerk sidebar nav — mirrors the admin pattern (Lucide icons, active-state
 * styling via `usePathname`). `/clerk/jobs/available` is matched before the
 * `/clerk/jobs` prefix to stop the My Jobs link lighting up on the
 * Available page.
 */
export function ClerkSidebarNav() {
  const pathname = usePathname()
  return (
    <nav>
      {NAV_ITEMS.map((item) => {
        const active = isActive(pathname, item)
        const Icon = item.icon
        return (
          <Link
            key={item.href}
            href={item.href}
            className="a-nav"
            aria-current={active ? 'page' : undefined}
          >
            <Icon className="h-5 w-5 shrink-0" />
            <span className="truncate">{item.title}</span>
          </Link>
        )
      })}
    </nav>
  )
}

function isActive(pathname: string, item: NavItem): boolean {
  if (item.exact) return pathname === item.href
  // Longest-prefix wins: only highlight an item if no other nav item has a
  // longer prefix that also matches. Avoids `/clerk/jobs` lighting up on
  // `/clerk/jobs/available`.
  if (!pathname.startsWith(item.href)) return false
  const longer = NAV_ITEMS.find(
    (n) =>
      n !== item &&
      n.href.startsWith(item.href) &&
      pathname.startsWith(n.href)
  )
  return !longer
}
