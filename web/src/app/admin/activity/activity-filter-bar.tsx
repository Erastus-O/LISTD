'use client'

import { useEffect, useState, useTransition } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Filter, Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const SENTINEL = '__all__'

// Kept in sync with AUDIT_CATEGORIES in lib/dashboard/activity-log.ts (which is
// server-only, so a client component can't import it).
const CATEGORIES = [
  'job_lifecycle',
  'verification',
  'impersonation',
  'pricing_override',
  'strike',
  'platform_setting',
  'tenant_portal_access',
  'account_status',
  'dispute',
  'billing',
] as const

const CATEGORY_OPTIONS = CATEGORIES.map((c) => ({
  value: c,
  label: c.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase()),
}))

export function ActivityFilterBar() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [pending, startTransition] = useTransition()

  const initial = {
    q: searchParams.get('q') ?? '',
    category: searchParams.get('category') ?? '',
    from: searchParams.get('from') ?? '',
    to: searchParams.get('to') ?? '',
  }

  const [q, setQ] = useState(initial.q)
  const [category, setCategory] = useState(initial.category)
  const [from, setFrom] = useState(initial.from)
  const [to, setTo] = useState(initial.to)
  const [open, setOpen] = useState(
    Boolean(initial.category || initial.from || initial.to)
  )

  useEffect(() => {
    if (q === initial.q) return
    const t = setTimeout(() => push({ q }), 250)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q])

  function push(patch: Record<string, string>) {
    const next = new URLSearchParams(searchParams.toString())
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v)
      else next.delete(k)
    }
    next.delete('page') // any filter change resets to page 1
    startTransition(() => router.replace(`${pathname}?${next.toString()}`))
  }

  function clearAll() {
    setQ('')
    setCategory('')
    setFrom('')
    setTo('')
    startTransition(() => router.replace(pathname))
  }

  const activeCount = [initial.category, initial.from, initial.to].filter(
    Boolean
  ).length

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[260px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search action, user name, or target ID…"
            className="h-9 pl-9 text-sm"
          />
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setOpen((o) => !o)}
          className="gap-1.5"
          disabled={pending}
        >
          <Filter className="h-3.5 w-3.5" />
          Filters
          {activeCount > 0 && (
            <span className="rounded-full bg-primary px-1.5 text-[10px] font-bold leading-4 text-primary-foreground">
              {activeCount}
            </span>
          )}
        </Button>
        {(activeCount > 0 || initial.q) && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={clearAll}
            className="gap-1 text-xs text-muted-foreground"
            disabled={pending}
          >
            <X className="h-3.5 w-3.5" />
            Clear
          </Button>
        )}
      </div>

      {open && (
        <div className="grid grid-cols-1 gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-3">
          <Field label="Category">
            <Select
              value={category === '' ? SENTINEL : category}
              onValueChange={(v) => {
                const val = v === SENTINEL ? '' : v
                setCategory(val)
                push({ category: val })
              }}
            >
              <SelectTrigger className="h-9 text-sm">
                <SelectValue placeholder="Any category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={SENTINEL}>Any category</SelectItem>
                {CATEGORY_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="From">
            <Input
              type="date"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value)
                push({ from: e.target.value })
              }}
              className="h-9 text-sm"
            />
          </Field>

          <Field label="To">
            <Input
              type="date"
              value={to}
              onChange={(e) => {
                setTo(e.target.value)
                push({ to: e.target.value })
              }}
              className="h-9 text-sm"
            />
          </Field>
        </div>
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </Label>
      <div className="mt-1.5">{children}</div>
    </div>
  )
}
