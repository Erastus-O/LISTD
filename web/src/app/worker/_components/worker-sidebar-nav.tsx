'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  BookOpen,
  Briefcase,
  FileText,
  LayoutDashboard,
  PlusCircle,
  Receipt,
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
    href: '/worker/dashboard',
    icon: LayoutDashboard,
    exact: true,
  },
  { title: 'Post a job', href: '/book', icon: PlusCircle },
  { title: 'My jobs', href: '/worker/jobs', icon: Briefcase },
  { title: 'My reports', href: '/worker/reports', icon: FileText },
  { title: 'Receipts', href: '/worker/invoices', icon: Receipt },
  { title: 'Settings', href: '/worker/settings', icon: Settings },
  { title: 'Help', href: '/help', icon: BookOpen },
]

/**
 * Worker sidebar — same visual pattern as client/clerk navs. "Post a job"
 * jumps the worker into the existing `/book` flow; the booking handler is
 * responsible for tagging the created job with the worker's user id +
 * organisation id (see `lib/jobs/create-job.ts`).
 */
export function WorkerSidebarNav() {
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
