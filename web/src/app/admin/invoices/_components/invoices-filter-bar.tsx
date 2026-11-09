'use client'

import { useEffect, useState, useTransition } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'draft', label: 'Draft' },
  { value: 'issued', label: 'Issued' },
  { value: 'sent', label: 'Sent' },
  { value: 'paid', label: 'Paid' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'void', label: 'Void' },
] as const

const KIND_OPTIONS = [
  { value: 'all', label: 'All kinds' },
  { value: 'invoice', label: 'Invoices' },
  { value: 'credit_note', label: 'Credit notes' },
] as const

const SENTINEL = '__all__'

/**
 * URL-driven filter row for /admin/invoices: search by reference,
 * filter by status. Mirrors the pattern from /admin/jobs filter bar —
 * debounced search input, instant status select.
 */
export function InvoicesFilterBar() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [pending, startTransition] = useTransition()

  const initialQ = searchParams.get('q') ?? ''
  const initialStatus = searchParams.get('status') ?? ''
  const initialKind = searchParams.get('kind') ?? ''
  const [q, setQ] = useState(initialQ)

  useEffect(() => {
    if (q === initialQ) return
    const t = setTimeout(() => push({ q }), 250)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q])

  function push(patch: Record<string, string>) {
    const params = new URLSearchParams(searchParams.toString())
    for (const [k, v] of Object.entries(patch)) {
      if (v) params.set(k, v)
      else params.delete(k)
    }
    params.delete('page')
    startTransition(() => router.replace(`${pathname}?${params.toString()}`))
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="relative min-w-[260px] flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by reference…"
          className="h-9 pl-9 text-sm"
          disabled={pending}
        />
      </div>
      <Select
        value={initialStatus === '' ? SENTINEL : initialStatus}
        onValueChange={(v) => push({ status: v === SENTINEL ? '' : v })}
      >
        <SelectTrigger className="h-9 w-40 text-sm">
          <SelectValue placeholder="All statuses" />
        </SelectTrigger>
        <SelectContent>
          {STATUS_OPTIONS.map((s) => (
            <SelectItem
              key={s.value}
              value={s.value === 'all' ? SENTINEL : s.value}
            >
              {s.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={initialKind === '' ? SENTINEL : initialKind}
        onValueChange={(v) => push({ kind: v === SENTINEL ? '' : v })}
      >
        <SelectTrigger className="h-9 w-40 text-sm">
          <SelectValue placeholder="All kinds" />
        </SelectTrigger>
        <SelectContent>
          {KIND_OPTIONS.map((k) => (
            <SelectItem
              key={k.value}
              value={k.value === 'all' ? SENTINEL : k.value}
            >
              {k.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
