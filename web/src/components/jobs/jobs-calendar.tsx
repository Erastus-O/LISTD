'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Status → chip tone mapping. The InventoryBase screenshot the design is
 * inspired by uses block colour per state; we mirror that here so a glance
 * at the month tells you the booking pipeline at a glance:
 *
 *   teal      → not yet claimed (published / scheduled / pending)
 *   indigo    → on a clerk's books (accepted / assigned / in_progress)
 *   amber     → in QA / awaiting sign-off (submitted / reviewed / in_review)
 *   slate     → finished (signed / completed / paid)
 *   rose      → cancelled (kept visible so admins spot churn)
 */
const STATUS_COLOR: Record<
  string,
  { bg: string; text: string; ring: string }
> = {
  draft:        { bg: 'bg-slate-200',       text: 'text-slate-700',       ring: 'ring-slate-300' },
  pending:      { bg: 'bg-teal-100',        text: 'text-teal-800',        ring: 'ring-teal-200' },
  published:    { bg: 'bg-teal-100',        text: 'text-teal-800',        ring: 'ring-teal-200' },
  scheduled:    { bg: 'bg-teal-100',        text: 'text-teal-800',        ring: 'ring-teal-200' },
  accepted:     { bg: 'bg-indigo-100',      text: 'text-indigo-800',      ring: 'ring-indigo-200' },
  assigned:     { bg: 'bg-indigo-100',      text: 'text-indigo-800',      ring: 'ring-indigo-200' },
  in_progress:  { bg: 'bg-indigo-200',      text: 'text-indigo-900',      ring: 'ring-indigo-300' },
  submitted:    { bg: 'bg-amber-100',       text: 'text-amber-900',       ring: 'ring-amber-200' },
  in_review:    { bg: 'bg-amber-100',       text: 'text-amber-900',       ring: 'ring-amber-200' },
  reviewed:     { bg: 'bg-amber-100',       text: 'text-amber-900',       ring: 'ring-amber-200' },
  signed:       { bg: 'bg-slate-200',       text: 'text-slate-700',       ring: 'ring-slate-300' },
  completed:    { bg: 'bg-slate-200',       text: 'text-slate-700',       ring: 'ring-slate-300' },
  paid:         { bg: 'bg-slate-200',       text: 'text-slate-700',       ring: 'ring-slate-300' },
  cancelled:    { bg: 'bg-rose-100',        text: 'text-rose-700',        ring: 'ring-rose-200' },
}

const DEFAULT_COLOR = { bg: 'bg-muted', text: 'text-muted-foreground', ring: 'ring-border' }

export type CalendarEvent = {
  id: string
  /** ISO date `YYYY-MM-DD`. Falls into the day cell that matches it. */
  date: string
  /** Short label shown on the chip, e.g. `New Inventory · BS1`. */
  label: string
  /** Job/inspection status — drives chip colour. */
  status: string
  /** Detail-page destination. */
  href: string
  /** Optional small line below the label (e.g. time slot or clerk name). */
  hint?: string
}

type Props = {
  events: CalendarEvent[]
  /** 1-indexed month + 4-digit year that the grid shows. */
  year: number
  month: number
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

/**
 * Month-grid calendar of bookings. Week-starts-Monday (UK convention).
 * Inspired by InventoryBase's inspections calendar: each day cell stacks
 * coloured chips per booking, colour-coded by status; clicking a chip
 * navigates to the detail page. Prev/next month + Today are URL-driven —
 * the component reads `usePathname()` / `useSearchParams()` itself so
 * the server page doesn't have to pass a non-serializable navigation
 * function across the RSC boundary.
 *
 * Built without a dedicated calendar lib — month math is a six-row grid
 * and chips are flex stacks. Keeps the bundle thin and lets the look
 * match the surrounding cards exactly.
 */
export function JobsCalendar({ events, year, month }: Props) {
  const pathname = usePathname()
  const searchParams = useSearchParams()

  function monthHref(y: number, m: number): string {
    const next = new URLSearchParams(searchParams.toString())
    next.set('view', 'calendar')
    next.set('month', `${y}-${String(m).padStart(2, '0')}`)
    next.delete('page')
    return `${pathname}?${next.toString()}`
  }

  // Compute "today" after mount so SSR + client hydration agree on the
  // empty key (no day highlighted). `new Date()` on the server is UTC,
  // on the client is local — picking a different cell for "today"
  // around midnight UK time would trip React #418 hydration mismatch.
  const [todayKey, setTodayKey] = useState<string>('')
  useEffect(() => {
    const now = new Date()
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot mount-time today calc
    setTodayKey(
      ymdKey(now.getFullYear(), now.getMonth() + 1, now.getDate())
    )
  }, [])

  // Bucket events by date for O(1) lookup per cell.
  const byDate = new Map<string, CalendarEvent[]>()
  for (const ev of events) {
    const arr = byDate.get(ev.date) ?? []
    arr.push(ev)
    byDate.set(ev.date, arr)
  }

  // Month-grid math. JS `Date` is 0-indexed for month; we keep `month`
  // 1-indexed in the public API.
  const firstOfMonth = new Date(year, month - 1, 1)
  // (getDay() returns 0=Sun … 6=Sat; we want 0=Mon … 6=Sun.)
  const leadDays = (firstOfMonth.getDay() + 6) % 7
  const daysInMonth = new Date(year, month, 0).getDate()
  // 42 cells = 6 weeks. Pad with prev-month tail and next-month head.
  const cells: Array<{ year: number; month: number; day: number; inMonth: boolean }> = []
  const daysInPrev = new Date(year, month - 1, 0).getDate()
  for (let i = leadDays - 1; i >= 0; i--) {
    const day = daysInPrev - i
    const prev = month === 1 ? { y: year - 1, m: 12 } : { y: year, m: month - 1 }
    cells.push({ year: prev.y, month: prev.m, day, inMonth: false })
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ year, month, day: d, inMonth: true })
  }
  while (cells.length < 42) {
    const last = cells[cells.length - 1]!
    const nextDay = last.day + 1
    const nextMonth =
      last.month === 12 ? { y: last.year + 1, m: 1 } : { y: last.year, m: last.month + 1 }
    const inNext = !last.inMonth || nextDay > daysInMonth
    if (inNext) {
      cells.push({ year: nextMonth.y, month: nextMonth.m, day: nextDay - daysInMonth, inMonth: false })
    } else {
      cells.push({ year, month, day: nextDay, inMonth: true })
    }
  }

  const prev = month === 1 ? { y: year - 1, m: 12 } : { y: year, m: month - 1 }
  const next = month === 12 ? { y: year + 1, m: 1 } : { y: year, m: month + 1 }
  // The Today nav link computes its target from the client's clock at
  // click time. Computing it at render would re-introduce the
  // server/client drift we just fixed; reading `new Date()` inside an
  // onClick (i.e. only on the client, after mount) is safe.
  const todayHref = (() => {
    if (!todayKey) return monthHref(year, month) // pre-hydration: keep current month
    const [y, m] = todayKey.split('-').map((p) => Number.parseInt(p, 10))
    return monthHref(y!, m!)
  })()

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-foreground">
          {MONTH_NAMES[month - 1]} {year}
        </h2>
        <div className="flex items-center gap-1">
          <Link
            href={monthHref(prev.y, prev.m)}
            aria-label="Previous month"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ChevronLeft className="h-4 w-4" />
          </Link>
          <Link
            href={todayHref}
            className="inline-flex h-8 items-center rounded-md border border-border px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            Today
          </Link>
          <Link
            href={monthHref(next.y, next.m)}
            aria-label="Next month"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ChevronRight className="h-4 w-4" />
          </Link>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="grid grid-cols-7 border-b border-border bg-muted/40 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {WEEKDAYS.map((d) => (
            <div key={d} className="px-2 py-1.5 text-center">
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((c, i) => {
            const key = ymdKey(c.year, c.month, c.day)
            const isToday = key === todayKey
            const dayEvents = byDate.get(key) ?? []
            return (
              <div
                key={`${key}-${i}`}
                className={cn(
                  'min-h-[88px] border-b border-r border-border p-1.5 text-xs',
                  !c.inMonth && 'bg-muted/30',
                  i % 7 === 6 && 'border-r-0',
                  i >= 35 && 'border-b-0'
                )}
              >
                <div
                  className={cn(
                    'mb-1 flex items-center justify-between text-[11px]',
                    !c.inMonth ? 'text-muted-foreground/60' : 'text-muted-foreground'
                  )}
                >
                  <span
                    className={cn(
                      isToday &&
                        'inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground'
                    )}
                  >
                    {c.day}
                  </span>
                </div>
                <div className="space-y-1">
                  {dayEvents.slice(0, 3).map((ev) => {
                    const color = STATUS_COLOR[ev.status] ?? DEFAULT_COLOR
                    return (
                      <Link
                        key={ev.id}
                        href={ev.href}
                        title={`${ev.label}${ev.hint ? ` · ${ev.hint}` : ''}`}
                        className={cn(
                          'block truncate rounded-md px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset transition-opacity hover:opacity-80',
                          color.bg,
                          color.text,
                          color.ring
                        )}
                      >
                        {ev.label}
                      </Link>
                    )
                  })}
                  {dayEvents.length > 3 && (
                    <p className="px-1 text-[10px] text-muted-foreground">
                      +{dayEvents.length - 3} more
                    </p>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <CalendarLegend />
    </div>
  )
}

function CalendarLegend() {
  const items: Array<{ label: string; key: string }> = [
    { label: 'Scheduled', key: 'published' },
    { label: 'Accepted', key: 'accepted' },
    { label: 'In progress', key: 'in_progress' },
    { label: 'In review', key: 'submitted' },
    { label: 'Completed', key: 'completed' },
    { label: 'Cancelled', key: 'cancelled' },
  ]
  return (
    <div className="flex flex-wrap gap-3 text-[10px] text-muted-foreground">
      {items.map((it) => {
        const c = STATUS_COLOR[it.key] ?? DEFAULT_COLOR
        return (
          <span key={it.key} className="inline-flex items-center gap-1.5">
            <span
              className={cn(
                'h-2 w-2 rounded-full ring-1 ring-inset',
                c.bg,
                c.ring
              )}
            />
            {it.label}
          </span>
        )
      })}
    </div>
  )
}

function ymdKey(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}
