'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  BookOpen,
  Briefcase,
  GraduationCap,
  LayoutDashboard,
  PoundSterling,
  Search,
  Settings,
  Sparkles,
  type LucideIcon,
} from 'lucide-react'
import type { ProServiceRole } from '@/lib/listd/pro-services'

type NavItem = { title: string; href: string; icon: LucideIcon; exact?: boolean }

/**
 * One menu for every Pro, whatever mix of services they offer. Inspections and
 * repairs live under /clerk, cleaning under /cleaner; a Pro who offers both
 * moves between them from here without noticing the split.
 */
export function proNavItems(services: readonly ProServiceRole[]): NavItem[] {
  const fieldwork = services.includes('clerk') || services.includes('trades')
  const cleaning = services.includes('cleaner')
  const home = fieldwork || !cleaning ? '/clerk' : '/cleaner'
  const workLabel = services.includes('clerk') && services.includes('trades') ? 'Inspections & repairs' : services.includes('trades') ? 'Repairs' : 'Inspections'
  const items: NavItem[] = [{ title: 'Dashboard', href: `${home}/dashboard`, icon: LayoutDashboard, exact: true }]
  if (fieldwork || !cleaning) {
    items.push(
      { title: cleaning ? `${workLabel}: find jobs` : 'Jobs', href: '/clerk/jobs/available', icon: Search },
      { title: cleaning ? `${workLabel}: schedule` : 'Schedule', href: '/clerk/jobs', icon: Briefcase }
    )
  }
  if (cleaning) {
    items.push(
      { title: fieldwork ? 'Cleaning: find jobs' : 'Jobs', href: '/cleaner/jobs/available', icon: fieldwork ? Sparkles : Search },
      { title: fieldwork ? 'Cleaning: schedule' : 'Schedule', href: '/cleaner/jobs', icon: Briefcase }
    )
  }
  items.push(
    { title: 'Training & level', href: `${home}/training`, icon: GraduationCap },
    { title: 'Earnings', href: `${home}/earnings`, icon: PoundSterling },
    { title: 'Settings', href: `${home}/settings`, icon: Settings },
    { title: 'Help', href: '/help', icon: BookOpen }
  )
  return items
}

export function ProSidebarNav({ services }: { services: ProServiceRole[] }) {
  const pathname = usePathname()
  const items = proNavItems(services)
  return (
    <nav>
      {items.map((item) => {
        const active = isActive(pathname, item, items)
        const Icon = item.icon
        return (
          <Link key={item.href} href={item.href} className="a-nav" aria-current={active ? 'page' : undefined}>
            <Icon className="h-5 w-5 shrink-0" />
            <span className="truncate">{item.title}</span>
          </Link>
        )
      })}
    </nav>
  )
}

// Longest prefix wins, so /clerk/jobs doesn't light up on /clerk/jobs/available.
function isActive(pathname: string, item: NavItem, items: NavItem[]): boolean {
  if (item.exact) return pathname === item.href
  if (!pathname.startsWith(item.href)) return false
  return !items.some((n) => n !== item && n.href.startsWith(item.href) && pathname.startsWith(n.href))
}
