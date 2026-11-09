'use client'

import { useTransition } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { ArrowUpDown, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  INSPECTION_TYPES,
  INSPECTION_TYPE_LABELS,
  type InspectionType,
} from '@/lib/pricing-matrix'

const SENTINEL = '__all__'

type Props = {
  postcodeDistricts: string[]
}

/**
 * URL-driven filter bar for /clerk/jobs/available. Service type / postcode
 * district / date range / sort. Dates use native `<input type="date">` to
 * avoid pulling Calendar + Popover deps that aren't shipped yet.
 */
export function AvailableJobsFilterBar({ postcodeDistricts }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [pending, startTransition] = useTransition()

  const initial = {
    type: searchParams.get('type') ?? '',
    postcode: searchParams.get('postcode') ?? '',
    from: searchParams.get('from') ?? '',
    to: searchParams.get('to') ?? '',
    sort: searchParams.get('sort') ?? 'date_asc',
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

  const hasActive =
    initial.type !== '' ||
    initial.postcode !== '' ||
    initial.from !== '' ||
    initial.to !== ''

  return (
    <div className="flex flex-wrap items-end gap-3">
      <Select
        value={initial.type === '' ? SENTINEL : initial.type}
        onValueChange={(v) => push({ type: v === SENTINEL ? '' : v })}
      >
        <SelectTrigger className="h-9 w-[160px] text-sm">
          <SelectValue placeholder="Service type" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={SENTINEL}>All types</SelectItem>
          {INSPECTION_TYPES.map((t) => (
            <SelectItem key={t} value={t}>
              {INSPECTION_TYPE_LABELS[t as InspectionType]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={initial.postcode === '' ? SENTINEL : initial.postcode}
        onValueChange={(v) => push({ postcode: v === SENTINEL ? '' : v })}
        disabled={postcodeDistricts.length === 0}
      >
        <SelectTrigger className="h-9 w-[140px] text-sm">
          <SelectValue
            placeholder={
              postcodeDistricts.length === 0 ? 'No areas' : 'Postcode'
            }
          />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={SENTINEL}>All areas</SelectItem>
          {postcodeDistricts.map((d) => (
            <SelectItem key={d} value={d}>
              {d}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="flex items-center gap-2">
        <Input
          type="date"
          value={initial.from}
          onChange={(e) => push({ from: e.target.value })}
          className="h-9 w-[140px] text-sm"
          aria-label="From date"
        />
        <span className="text-xs text-muted-foreground">→</span>
        <Input
          type="date"
          value={initial.to}
          onChange={(e) => push({ to: e.target.value })}
          className="h-9 w-[140px] text-sm"
          aria-label="To date"
        />
      </div>

      <Select
        value={initial.sort}
        onValueChange={(v) => push({ sort: v === 'date_asc' ? '' : v })}
      >
        <SelectTrigger className="h-9 w-[170px] text-sm">
          <ArrowUpDown className="mr-1 h-3.5 w-3.5" />
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="date_asc">Date (soonest)</SelectItem>
          <SelectItem value="pay_desc">Pay (highest)</SelectItem>
          <SelectItem value="posted_desc">Posted (newest)</SelectItem>
        </SelectContent>
      </Select>

      {hasActive && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={clearAll}
          disabled={pending}
          className="h-9 gap-1 text-xs text-muted-foreground"
        >
          <X className="h-3.5 w-3.5" />
          Clear filters
        </Button>
      )}
    </div>
  )
}
