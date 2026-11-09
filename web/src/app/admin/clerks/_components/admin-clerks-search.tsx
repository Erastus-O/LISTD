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

const SENTINEL = '__all__'

const LEVEL_OPTIONS = [
  { value: '0', label: 'Unverified' },
  { value: '1', label: 'Level 1' },
  { value: '2', label: 'Level 2' },
  { value: '3', label: 'Level 3' },
] as const

const STATUS_OPTIONS = [
  { value: 'unverified', label: 'Unverified' },
  { value: 'pending_verification', label: 'Pending review' },
  { value: 'verified', label: 'Verified' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'suspended', label: 'Suspended' },
] as const

/**
 * URL-driven filter row for /admin/clerks (S6d, Clerk Management view).
 * Four controls: search box, level, status, region/postcode (debounced).
 */
export function AdminClerksSearch() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [pending, startTransition] = useTransition()

  const initialQ = searchParams.get('q') ?? ''
  const initialLevel = searchParams.get('level') ?? ''
  const initialStatus = searchParams.get('status') ?? ''
  const initialRegion = searchParams.get('region') ?? ''
  const [q, setQ] = useState(initialQ)
  const [region, setRegion] = useState(initialRegion)

  useEffect(() => {
    if (q === initialQ) return
    const t = setTimeout(() => push({ q }), 250)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q])

  useEffect(() => {
    if (region === initialRegion) return
    const t = setTimeout(() => push({ region }), 250)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [region])

  function push(patch: Record<string, string>) {
    const params = new URLSearchParams(searchParams.toString())
    for (const [k, v] of Object.entries(patch)) {
      if (v) params.set(k, v)
      else params.delete(k)
    }
    startTransition(() => router.replace(`${pathname}?${params.toString()}`))
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="relative min-w-[260px] flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by name…"
          className="h-9 pl-9 text-sm"
          disabled={pending}
        />
      </div>

      <Select
        value={initialLevel === '' ? SENTINEL : initialLevel}
        onValueChange={(v) => push({ level: v === SENTINEL ? '' : v })}
      >
        <SelectTrigger className="h-9 w-32 text-sm">
          <SelectValue placeholder="All levels" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={SENTINEL}>All levels</SelectItem>
          {LEVEL_OPTIONS.map((l) => (
            <SelectItem key={l.value} value={l.value}>
              {l.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={initialStatus === '' ? SENTINEL : initialStatus}
        onValueChange={(v) => push({ status: v === SENTINEL ? '' : v })}
      >
        <SelectTrigger className="h-9 w-40 text-sm">
          <SelectValue placeholder="All statuses" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={SENTINEL}>All statuses</SelectItem>
          {STATUS_OPTIONS.map((s) => (
            <SelectItem key={s.value} value={s.value}>
              {s.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Input
        value={region}
        onChange={(e) => setRegion(e.target.value)}
        placeholder="Region/postcode…"
        className="h-9 w-40 text-sm"
        disabled={pending}
      />
    </div>
  )
}
