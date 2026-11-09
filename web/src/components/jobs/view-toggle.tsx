'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { CalendarDays, List, MapPin } from 'lucide-react'
import { cn } from '@/lib/utils'

export type JobsView = 'list' | 'calendar' | 'map'

type Props = {
  /** Active view, defaults to `list`. */
  view?: JobsView
  /** Subset of views this page supports. Pages with no postcode/geocoding
   *  use case can leave 'map' out; pages that only want a flat list can
   *  pass just ['list']. Order is preserved in the rendered pills. */
  views?: JobsView[]
}

const META: Record<JobsView, { label: string; icon: typeof List }> = {
  list: { label: 'List', icon: List },
  calendar: { label: 'Calendar', icon: CalendarDays },
  map: { label: 'Map', icon: MapPin },
}

/**
 * URL-driven view toggle. Drives `?view=<value>` on the current URL
 * (omitted for the default `list` view) so filters / pagination from the
 * rest of the page stay intact across switches. Pages declare their own
 * supported `views` so admin can show List|Calendar|Map while a clerk's
 * own job list shows just List|Calendar.
 */
export function JobsViewToggle({
  view = 'list',
  views = ['list', 'calendar', 'map'],
}: Props) {
  const pathname = usePathname()
  const searchParams = useSearchParams()

  function hrefFor(target: JobsView): string {
    const params = new URLSearchParams(searchParams.toString())
    if (target === 'list') params.delete('view')
    else params.set('view', target)
    // Reset pagination when switching — Calendar and Map render the
    // current month / full filtered set, neither of which pages.
    params.delete('page')
    // Drop the calendar month pointer when leaving Calendar so a stale
    // ?month=2026-02 doesn't sit in the URL on List/Map.
    if (target !== 'calendar') params.delete('month')
    const qs = params.toString()
    return qs ? `${pathname}?${qs}` : pathname
  }

  return (
    <div className="inline-flex items-center rounded-lg border border-border bg-card p-0.5 text-xs">
      {views.map((v) => {
        const { label, icon: Icon } = META[v]
        return (
          <Pill key={v} href={hrefFor(v)} active={view === v}>
            <Icon className="h-3.5 w-3.5" />
            {label}
          </Pill>
        )
      })}
    </div>
  )
}

function Pill({
  href,
  active,
  children,
}: {
  href: string
  active: boolean
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 font-medium transition-colors',
        active
          ? 'bg-primary text-primary-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground'
      )}
    >
      {children}
    </Link>
  )
}
