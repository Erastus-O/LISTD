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

const STATUSES = [
  { value: 'draft', label: 'Draft' },
  { value: 'pending', label: 'Pending' },
  { value: 'published', label: 'Published' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'assigned', label: 'Assigned' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'reviewed', label: 'Reviewed' },
  { value: 'signed', label: 'Signed' },
  { value: 'completed', label: 'Completed' },
  { value: 'paid', label: 'Paid' },
  { value: 'cancelled', label: 'Cancelled' },
] as const

const TYPES = [
  { value: 'new_inventory', label: 'New Inventory' },
  { value: 'check_in', label: 'Check-In' },
  { value: 'check_out', label: 'Check-Out' },
  { value: 'mid_term', label: 'Mid-Term' },
  { value: 'interim', label: 'Interim' },
] as const

/**
 * URL-driven admin jobs filter bar (S6c). Same shape as the email-logs and
 * client-reports filter bars: debounced free-text search, instant push for
 * selects, badged active filter count, "Clear" CTA. Filter changes reset
 * pagination by dropping the `page` param.
 */
export function AdminJobsFilterBar() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [pending, startTransition] = useTransition()

  const initial = {
    q: searchParams.get('q') ?? '',
    status: searchParams.get('status') ?? '',
    type: searchParams.get('type') ?? '',
  }

  const [q, setQ] = useState(initial.q)
  const [status, setStatus] = useState(initial.status)
  const [type, setType] = useState(initial.type)
  const [open, setOpen] = useState(Boolean(initial.status || initial.type))

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
    next.delete('page')
    startTransition(() => router.replace(`${pathname}?${next.toString()}`))
  }

  function clearAll() {
    setQ('')
    setStatus('')
    setType('')
    startTransition(() => router.replace(pathname))
  }

  const activeCount = [initial.status, initial.type].filter(Boolean).length

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[260px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search address, postcode, client…"
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
        <div className="grid grid-cols-1 gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-2">
          <Field label="Status">
            <PillSelect
              value={status}
              onValueChange={(v) => {
                setStatus(v)
                push({ status: v })
              }}
              placeholder="Any status"
              options={STATUSES}
            />
          </Field>
          <Field label="Service type">
            <PillSelect
              value={type}
              onValueChange={(v) => {
                setType(v)
                push({ type: v })
              }}
              placeholder="Any type"
              options={TYPES}
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

function PillSelect({
  value,
  onValueChange,
  placeholder,
  options,
}: {
  value: string
  onValueChange: (v: string) => void
  placeholder: string
  options: ReadonlyArray<{ value: string; label: string }>
}) {
  return (
    <Select
      value={value === '' ? SENTINEL : value}
      onValueChange={(v) => onValueChange(v === SENTINEL ? '' : v)}
    >
      <SelectTrigger className="h-9 text-sm">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={SENTINEL}>{placeholder}</SelectItem>
        {options.map((opt) => (
          <SelectItem key={opt.value} value={opt.value}>
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
