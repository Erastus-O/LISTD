'use client'

import { useTransition } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const SENTINEL = '__all__'

const STATUS_OPTIONS = [
  { value: 'open', label: 'Open' },
  { value: 'under_review', label: 'Under review' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'escalated', label: 'Escalated' },
] as const

/**
 * Status filter for /admin/disputes (S6d-2 alignment with Lovable layout —
 * single dropdown rather than a pill row). URL-driven via `?status=…`.
 */
export function AdminDisputesStatusSelect() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [, startTransition] = useTransition()

  const initial = searchParams.get('status') ?? ''

  function push(next: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (next) params.set('status', next)
    else params.delete('status')
    startTransition(() => router.replace(`${pathname}?${params.toString()}`))
  }

  return (
    <Select
      value={initial === '' ? SENTINEL : initial}
      onValueChange={(v) => push(v === SENTINEL ? '' : v)}
    >
      <SelectTrigger className="h-9 w-44 text-sm">
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
  )
}
