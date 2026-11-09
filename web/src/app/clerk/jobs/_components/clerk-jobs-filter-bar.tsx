'use client'

import { useTransition } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const SENTINEL = '__all__'

const STATUS_OPTIONS = [
  { value: 'pending', label: 'Pending' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'completed', label: 'Completed' },
] as const

/**
 * URL-driven filter bar for /clerk/jobs. Status is bucketed into the same
 * three groups Lovable surfaced (pending / in-progress / completed). Date
 * range narrows by `scheduled_date`.
 */
export function ClerkJobsFilterBar() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [pending, startTransition] = useTransition()

  const initial = {
    status: searchParams.get('status') ?? '',
    from: searchParams.get('from') ?? '',
    to: searchParams.get('to') ?? '',
  }

  function push(patch: Record<string, string>) {
    const params = new URLSearchParams(searchParams.toString())
    for (const [k, v] of Object.entries(patch)) {
      if (v) params.set(k, v)
      else params.delete(k)
    }
    startTransition(() => router.replace(`${pathname}?${params.toString()}`))
  }

  function clearAll() {
    startTransition(() => router.replace(pathname))
  }

  const hasActive = initial.status !== '' || initial.from !== '' || initial.to !== ''

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Select
        value={initial.status === '' ? SENTINEL : initial.status}
        onValueChange={(v) => push({ status: v === SENTINEL ? '' : v })}
      >
        <SelectTrigger className="h-9 w-[160px] text-sm">
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
        type="date"
        value={initial.from}
        onChange={(e) => push({ from: e.target.value })}
        className="h-9 w-[150px] text-sm"
        aria-label="From date"
      />
      <span className="text-xs text-muted-foreground">→</span>
      <Input
        type="date"
        value={initial.to}
        onChange={(e) => push({ to: e.target.value })}
        className="h-9 w-[150px] text-sm"
        aria-label="To date"
      />

      {hasActive && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={clearAll}
          disabled={pending}
          className="gap-1 text-xs text-muted-foreground"
        >
          <X className="h-3.5 w-3.5" />
          Clear
        </Button>
      )}
    </div>
  )
}
