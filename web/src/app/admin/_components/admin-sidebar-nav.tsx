'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  GraduationCap,
  Activity,
  AlertTriangle,
  Banknote,
  Bell,
  BookOpen,
  Briefcase,
  FileLock2,
  FilePlus2,
  FileText,
  HardHat,
  Megaphone,
  LayoutDashboard,
  PoundSterling,
  Receipt,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Tag,
  Users,
  type LucideIcon,
} from 'lucide-react'

type NavItem = {
  title: string
  href: string
  icon: LucideIcon
  /** When true, the item only matches the exact path. Defaults to "starts-with"
   *  so e.g. /admin/jobs/abc highlights the Jobs link. */
  exact?: boolean
}

const NAV_ITEMS: NavItem[] = [
  { title: 'Overview', href: '/admin/dashboard', icon: LayoutDashboard, exact: true },
  { title: 'Bookings', href: '/admin/jobs', icon: Briefcase },
  { title: 'Training', href: '/admin/training', icon: GraduationCap },
  { title: 'Clients', href: '/admin/clients', icon: Users },
  { title: 'Pros', href: '/admin/clerks', icon: HardHat },
  { title: 'Report reviews', href: '/admin/quality-review', icon: ShieldCheck },
  { title: 'Disputes', href: '/admin/disputes', icon: AlertTriangle },
  { title: 'Invoicing', href: '/admin/invoices', icon: Receipt },
  { title: 'Recurring', href: '/admin/billing/recurring', icon: RefreshCw },
  { title: 'Reconcile', href: '/admin/billing/reconcile', icon: Banknote },
  { title: 'Pricing', href: '/admin/pricing', icon: PoundSterling },
  { title: 'Promo codes', href: '/admin/promos', icon: Tag },
  { title: 'Notifications', href: '/admin/notifications', icon: Bell },
  { title: 'Inventory settings', href: '/admin/templates', icon: FileText },
  { title: 'Generate report', href: '/admin/generate-report', icon: FilePlus2 },
  { title: 'AI', href: '/admin/ai', icon: Sparkles },
  { title: 'SEO', href: '/admin/seo', icon: Search },
  { title: 'Careers', href: '/admin/careers', icon: Megaphone },
  { title: 'Audit log', href: '/admin/activity', icon: Activity },
  { title: 'Data requests', href: '/admin/data-requests', icon: FileLock2 },
  { title: 'Settings', href: '/admin/settings', icon: Settings },
  { title: 'Help', href: '/help', icon: BookOpen },
]

/**
 * Admin sidebar nav (matches the Lovable AdminLayout sidebar). 14 items with
 * Lucide icons; active item highlighted via `usePathname()` — exact match for
 * the Dashboard root, prefix match for everything else (so the highlight
 * carries through detail pages).
 *
 * Email logs aren't in the visible sidebar — they're an audit/observability
 * surface accessed from Settings (or directly via URL).
 */
export function AdminSidebarNav({
  marketingOnly = false,
}: {
  /** Restricted 'marketing' seat: show only the SEO editor (+ Help). */
  marketingOnly?: boolean
}) {
  const pathname = usePathname()
  const items = marketingOnly
    ? NAV_ITEMS.filter((i) => i.href === '/admin/seo' || i.href === '/help')
    : NAV_ITEMS
  return (
    <nav>
      {items.map((item) => {
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
