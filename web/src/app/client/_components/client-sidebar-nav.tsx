'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  BookOpen,
  Briefcase,
  FileText,
  LayoutDashboard,
  Receipt,
  ScrollText,
  Settings,
  Users,
  type LucideIcon,
} from 'lucide-react'

type NavItem = {
  title: string
  href: string
  icon: LucideIcon
  /** Exact-match flag — defaults to "starts-with" so detail pages stay
   *  highlighted under their list parent (e.g. /client/jobs/abc highlights
   *  Jobs). */
  exact?: boolean
}

const NAV_ITEMS: NavItem[] = [
  {
    title: 'Dashboard',
    href: '/client/dashboard',
    icon: LayoutDashboard,
    exact: true,
  },
  { title: 'Bookings', href: '/client/jobs', icon: Briefcase },
  { title: 'Reports', href: '/client/reports', icon: FileText },
  { title: 'Receipts', href: '/client/invoices', icon: Receipt },
  { title: 'Statement', href: '/client/statement', icon: ScrollText },
  { title: 'Team', href: '/client/team', icon: Users },
  { title: 'Settings', href: '/client/settings', icon: Settings },
  { title: 'Help', href: '/help', icon: BookOpen },
]

/**
 * Client sidebar nav — mirrors the admin pattern (Lucide icons, active
 * state via `usePathname`). Shorter than admin since clients have fewer
 * top-level surfaces.
 */
export function ClientSidebarNav() {
  const pathname = usePathname()
  return (
    <nav>
      {NAV_ITEMS.map((item) => {
        const active = item.exact
          ? pathname === item.href
          : pathname.startsWith(item.href)
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
