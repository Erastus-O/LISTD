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

const INSPECTION_TYPES = [
  { value: 'new_inventory', label: 'New Inventory' },
  { value: 'check_in', label: 'Check-In' },
  { value: 'check_out', label: 'Check-Out' },
  { value: 'mid_term', label: 'Mid-Term' },
  { value: 'interim', label: 'Interim' },
] as const

const STATUSES = [
  { value: 'draft', label: 'Draft' },
  { value: 'pending', label: 'Pending' },
  { value: 'published', label: 'Published' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'assigned', label: 'Assigned' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'reviewed', label: 'Reviewed' },
  { value: 'signed', label: 'Signed' },
  { value: 'completed', label: 'Completed' },
  { value: 'paid', label: 'Paid' },
  { value: 'cancelled', label: 'Cancelled' },
] as const

type Props = {
  filterOptions: {
    teamMembers: Array<{ userId: string; name: string }>
    clerks: Array<{ userId: string; name: string }>
  }
}

export function JobsFilterBar({ filterOptions }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [pending, startTransition] = useTransition()

  // Hydrate from URL.
  const initial = {
    q: searchParams.get('q') ?? '',
    type: searchParams.get('type') ?? '',
    status: searchParams.get('status') ?? '',
    clerkId: searchParams.get('clerkId') ?? '',
    teamMemberId: searchParams.get('teamMemberId') ?? '',
    from: searchParams.get('from') ?? '',
    to: searchParams.get('to') ?? '',
  }

  const [q, setQ] = useState(initial.q)
  const [type, setType] = useState(initial.type)
  const [status, setStatus] = useState(initial.status)
  const [clerkId, setClerkId] = useState(initial.clerkId)
  const [teamMemberId, setTeamMemberId] = useState(initial.teamMemberId)
  const [from, setFrom] = useState(initial.from)
  const [to, setTo] = useState(initial.to)
  const [open, setOpen] = useState(
    Boolean(
      initial.type ||
        initial.status ||
        initial.clerkId ||
        initial.teamMemberId ||
        initial.from ||
        initial.to
    )
  )

  // Debounce the free-text search so we don't push a new URL on every keystroke.
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
    startTransition(() => {
      router.replace(`${pathname}?${next.toString()}`)
    })
  }

  function clearAll() {
    setQ('')
    setType('')
    setStatus('')
    setClerkId('')
    setTeamMemberId('')
    setFrom('')
    setTo('')
    startTransition(() => router.replace(pathname))
  }

  const activeCount = [
    initial.type,
    initial.status,
    initial.clerkId,
    initial.teamMemberId,
    initial.from,
    initial.to,
  ].filter(Boolean).length

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search address or postcode…"
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
        <div className="grid grid-cols-1 gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-2 lg:grid-cols-3">
          <FilterField label="Service type">
            <FilterSelect
              value={type}
              onValueChange={(v) => {
                setType(v)
                push({ type: v })
              }}
              placeholder="Any service"
              options={INSPECTION_TYPES}
            />
          </FilterField>

          <FilterField label="Status">
            <FilterSelect
              value={status}
              onValueChange={(v) => {
                setStatus(v)
                push({ status: v })
              }}
              placeholder="Any status"
              options={STATUSES}
            />
          </FilterField>

          <FilterField label="Clerk">
            <FilterSelect
              value={clerkId}
              onValueChange={(v) => {
                setClerkId(v)
                push({ clerkId: v })
              }}
              placeholder={
                filterOptions.clerks.length === 0
                  ? 'No clerks yet'
                  : 'Any clerk'
              }
              options={filterOptions.clerks.map((c) => ({
                value: c.userId,
                label: c.name,
              }))}
              disabled={filterOptions.clerks.length === 0}
            />
          </FilterField>

          <FilterField label="Team member">
            <FilterSelect
              value={teamMemberId}
              onValueChange={(v) => {
                setTeamMemberId(v)
                push({ teamMemberId: v })
              }}
              placeholder={
                filterOptions.teamMembers.length === 0
                  ? 'Solo account'
                  : 'Any team member'
              }
              options={filterOptions.teamMembers.map((m) => ({
                value: m.userId,
                label: m.name,
              }))}
              disabled={filterOptions.teamMembers.length === 0}
            />
          </FilterField>

          <FilterField label="From">
            <Input
              type="date"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value)
                push({ from: e.target.value })
              }}
              className="h-9 text-sm"
            />
          </FilterField>

          <FilterField label="To">
            <Input
              type="date"
              value={to}
              onChange={(e) => {
                setTo(e.target.value)
                push({ to: e.target.value })
              }}
              className="h-9 text-sm"
            />
          </FilterField>
        </div>
      )}
    </div>
  )
}

function FilterField({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div>
      <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </Label>
      <div className="mt-1.5">{children}</div>
    </div>
  )
}

function FilterSelect({
  value,
  onValueChange,
  placeholder,
  options,
  disabled,
}: {
  value: string
  onValueChange: (v: string) => void
  placeholder: string
  options: ReadonlyArray<{ value: string; label: string }>
  disabled?: boolean
}) {
  return (
    <Select
      value={value === '' ? SENTINEL : value}
      onValueChange={(v) => onValueChange(v === SENTINEL ? '' : v)}
      disabled={disabled}
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
