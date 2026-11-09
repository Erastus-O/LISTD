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

const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'suspended', label: 'Suspended' },
  { value: 'deleted', label: 'Deleted' },
] as const

type Props = {
  orgOptions: Array<{ id: string; name: string }>
}

/**
 * URL-driven filter row for /admin/clients (S6d). Three controls inline:
 * search box + Status select + Org select. Same debounce / instant-push
 * convention as the email-logs and reports filter bars.
 */
export function AdminClientsSearch({ orgOptions }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [pending, startTransition] = useTransition()

  const initialQ = searchParams.get('q') ?? ''
  const initialStatus = searchParams.get('status') ?? ''
  const initialOrg = searchParams.get('orgId') ?? ''
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
          placeholder="Search name or email…"
          className="h-9 pl-9 text-sm"
          disabled={pending}
        />
      </div>

      <Select
        value={initialStatus === '' ? SENTINEL : initialStatus}
        onValueChange={(v) =>
          push({ status: v === SENTINEL ? '' : v })
        }
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

      <Select
        value={initialOrg === '' ? SENTINEL : initialOrg}
        onValueChange={(v) => push({ orgId: v === SENTINEL ? '' : v })}
        disabled={orgOptions.length === 0}
      >
        <SelectTrigger className="h-9 w-44 text-sm">
          <SelectValue
            placeholder={orgOptions.length === 0 ? 'No orgs' : 'All orgs'}
          />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={SENTINEL}>All orgs</SelectItem>
          {orgOptions.map((o) => (
            <SelectItem key={o.id} value={o.id}>
              {o.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
