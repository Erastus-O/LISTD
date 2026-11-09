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
  exact?: boolean
}

const NAV_ITEMS: NavItem[] = [
  {
    title: 'Dashboard',
    href: '/cleaner/dashboard',
    icon: LayoutDashboard,
    exact: true,
  },
  { title: 'Jobs', href: '/cleaner/jobs/available', icon: Search },
  // `/cleaner/jobs/available` is more specific than `/cleaner/jobs`; list it
  // first and rely on the longest-match logic in `isActive`.
  { title: 'Schedule', href: '/cleaner/jobs', icon: Briefcase },
  { title: 'Training & level', href: '/cleaner/training', icon: GraduationCap },
  { title: 'Earnings', href: '/cleaner/earnings', icon: PoundSterling },
  { title: 'Settings', href: '/cleaner/settings', icon: Settings },
  { title: 'Help', href: '/help', icon: BookOpen },
]

/** Cleaner sidebar nav — mirrors the clerk nav (active-state via usePathname). */
export function CleanerSidebarNav() {
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
  if (!pathname.startsWith(item.href)) return false
  const longer = NAV_ITEMS.find(
    (n) =>
      n !== item &&
      n.href.startsWith(item.href) &&
      pathname.startsWith(n.href)
  )
  return !longer
}
