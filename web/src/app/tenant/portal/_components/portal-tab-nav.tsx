'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { BookOpen, FileText, FolderOpen } from 'lucide-react'

/**
 * Tenant portal tab navigation. Client component because it needs both
 * `usePathname` (active tab) and `useSearchParams` (preserve `?token=…`
 * across tabs without losing the only credential the visitor has).
 */
export function PortalTabNav() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const token = searchParams.get('token')
  const qs = token ? `?token=${encodeURIComponent(token)}` : ''

  const isDocuments = pathname.endsWith('/documents')
  const isHelp = pathname.endsWith('/help')
  const isReports = !isDocuments && !isHelp

  return (
    <nav className="border-b border-border bg-card">
      <div className="mx-auto flex max-w-3xl">
        <TabLink
          href={`/tenant/portal${qs}`}
          active={isReports}
          icon={<FileText className="h-3.5 w-3.5" />}
          label="My Reports"
        />
        <TabLink
          href={`/tenant/portal/documents${qs}`}
          active={isDocuments}
          icon={<FolderOpen className="h-3.5 w-3.5" />}
          label="Documents"
        />
        <TabLink
          href={`/tenant/portal/help${qs}`}
          active={isHelp}
          icon={<BookOpen className="h-3.5 w-3.5" />}
          label="Help"
        />
      </div>
    </nav>
  )
}

function TabLink({
  href,
  active,
  icon,
  label,
}: {
  href: string
  active: boolean
  icon: React.ReactNode
  label: string
}) {
  return (
    <Link
      href={href}
      className={`flex items-center gap-1.5 border-b-2 px-4 py-2.5 text-xs font-medium transition-colors ${
        active
          ? 'border-primary text-primary'
          : 'border-transparent text-muted-foreground hover:text-foreground'
      }`}
    >
      {icon}
      {label}
    </Link>
  )
}
