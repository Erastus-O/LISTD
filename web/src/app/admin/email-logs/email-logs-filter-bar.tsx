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
  { value: 'sent', label: 'Sent' },
  { value: 'failed', label: 'Failed' },
  { value: 'bounced', label: 'Bounced / complaint' },
  { value: 'webhook', label: 'Webhook event' },
] as const

type Props = {
  functionNames: string[]
}

export function EmailLogsFilterBar({ functionNames }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [pending, startTransition] = useTransition()

  const initial = {
    q: searchParams.get('q') ?? '',
    template: searchParams.get('template') ?? '',
    status: searchParams.get('status') ?? '',
    from: searchParams.get('from') ?? '',
    to: searchParams.get('to') ?? '',
  }

  const [q, setQ] = useState(initial.q)
  const [template, setTemplate] = useState(initial.template)
  const [status, setStatus] = useState(initial.status)
  const [from, setFrom] = useState(initial.from)
  const [to, setTo] = useState(initial.to)
  const [open, setOpen] = useState(
    Boolean(initial.template || initial.status || initial.from || initial.to)
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
    startTransition(() => router.replace(`${pathname}?${next.toString()}`))
  }

  function clearAll() {
    setQ('')
    setTemplate('')
    setStatus('')
    setFrom('')
    setTo('')
    startTransition(() => router.replace(pathname))
  }

  const activeCount = [initial.template, initial.status, initial.from, initial.to].filter(Boolean).length

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[260px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search recipient, subject, or Resend ID…"
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
        <div className="grid grid-cols-1 gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Template">
            <PillSelect
              value={template}
              onValueChange={(v) => {
                setTemplate(v)
                push({ template: v })
              }}
              placeholder={functionNames.length === 0 ? 'No events yet' : 'Any template'}
              options={functionNames.map((fn) => ({ value: fn, label: fn }))}
              disabled={functionNames.length === 0}
            />
          </Field>

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

function PillSelect({
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
