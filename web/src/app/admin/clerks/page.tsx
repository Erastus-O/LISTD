import Link from 'next/link'
import { eq, inArray } from 'drizzle-orm'
import { Eye } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { profiles, userRoles, withServiceRole } from '@/db'
import { requireRole } from '@/lib/dal'
import { AdminClerksSearch } from './_components/admin-clerks-search'

export const metadata = { title: 'Admin · Pros' }

const STATUSES = [
  'unverified',
  'pending_verification',
  'verified',
  'rejected',
  'suspended',
] as const
type Status = (typeof STATUSES)[number]

const STATUS_LABEL: Record<Status, string> = {
  unverified: 'Unverified',
  pending_verification: 'Pending review',
  verified: 'Verified',
  rejected: 'Rejected',
  suspended: 'Suspended',
}

const STATUS_TONE: Record<
  Status,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  unverified: 'outline',
  pending_verification: 'default',
  verified: 'secondary',
  rejected: 'destructive',
  suspended: 'destructive',
}

const LEVEL_TONE: Record<
  number,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  0: 'outline',
  1: 'secondary',
  2: 'default',
  3: 'default',
}

const EXPIRY_WINDOW_DAYS = 30

type Search = Promise<{
  q?: string
  level?: string
  status?: string
  region?: string
}>

/**
 * Clerk Management (S6d table reskin of the M1 #7 clerks page). URL-driven
 * filters: q (name), level (0–3), status, region/postcode (matches any
 * `coverage_areas` entry case-insensitively).
 */
export default async function AdminClerksPage({
  searchParams,
}: {
  searchParams: Search
}) {
  await requireRole('admin')
  const sp = await searchParams
  const filterStatus =
    sp.status && (STATUSES as readonly string[]).includes(sp.status)
      ? (sp.status as Status)
      : null
  const filterLevel = sp.level
    ? Number.isFinite(Number.parseInt(sp.level, 10))
      ? Number.parseInt(sp.level, 10)
      : null
    : null
  const filterQ = sp.q?.trim().toLowerCase() ?? ''
  const filterRegion = sp.region?.trim().toLowerCase() ?? ''

  // Service-role read: admin-gated. Pulls every clerk-role profile in one
  // round-trip; filters and pagination happen in JS since the volume of
  // clerks per Pro deployment is small (hundreds, not millions).
  const rows = await withServiceRole(async (tx) => {
    const clerkIds = await tx
      .select({ userId: userRoles.userId })
      .from(userRoles)
      .where(eq(userRoles.role, 'clerk'))
    if (clerkIds.length === 0) return []
    const ids = Array.from(new Set(clerkIds.map((r) => r.userId)))
    return tx
      .select({
        userId: profiles.userId,
        fullName: profiles.fullName,
        verificationStatus: profiles.verificationStatus,
        coverageAreas: profiles.coverageAreas,
        clerkLevel: profiles.clerkLevel,
        clerkRating: profiles.clerkRating,
        clerkJobsCompleted: profiles.clerkJobsCompleted,
        dbsExpiry: profiles.dbsExpiry,
        insuranceExpiry: profiles.insuranceExpiry,
      })
      .from(profiles)
      .where(inArray(profiles.userId, ids))
  })

  const filtered = rows.filter((c) => {
    const status = (c.verificationStatus ?? 'unverified') as Status
    if (filterStatus && status !== filterStatus) return false
    const level = c.clerkLevel ?? 0
    if (filterLevel !== null && level !== filterLevel) return false
    if (filterQ && !(c.fullName ?? '').toLowerCase().includes(filterQ)) {
      return false
    }
    if (filterRegion) {
      const areas = c.coverageAreas ?? []
      if (!areas.some((a) => a.toLowerCase().includes(filterRegion))) {
        return false
      }
    }
    return true
  })

  // Pending review first when no explicit status filter — that's the
  // admin's daily queue.
  filtered.sort((a, b) => {
    const order = (s: string | null) =>
      s === 'pending_verification' ? 0 : s === 'rejected' ? 1 : s === 'verified' ? 2 : 3
    return order(a.verificationStatus) - order(b.verificationStatus)
  })

  return (
    <div className="w-full space-y-6 px-6 py-10">
      <div>
        <h1 className="font-display text-3xl text-foreground">
          Clerk Management
        </h1>
      </div>

      <AdminClerksSearch />

      <p className="text-xs text-muted-foreground">
        {filtered.length} {filtered.length === 1 ? 'clerk' : 'clerks'}
      </p>

      {filtered.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No clerks match this filter.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5 text-left font-medium">Name</th>
                    <th className="px-4 py-2.5 text-left font-medium">Badge</th>
                    <th className="px-4 py-2.5 text-left font-medium">Region</th>
                    <th className="px-4 py-2.5 text-right font-medium">Jobs</th>
                    <th className="px-4 py-2.5 text-right font-medium">Avg rating</th>
                    <th className="px-4 py-2.5 text-left font-medium">DBS expiry</th>
                    <th className="px-4 py-2.5 text-left font-medium">Insurance expiry</th>
                    <th className="px-4 py-2.5 text-left font-medium">Status</th>
                    <th className="px-4 py-2.5 text-right font-medium" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filtered.map((c) => {
                    const status = (c.verificationStatus ?? 'unverified') as Status
                    const level = c.clerkLevel ?? 0
                    return (
                      <tr key={c.userId} className="hover:bg-muted/30">
                        <td className="px-4 py-2.5">
                          <Link
                            href={`/admin/clerks/${c.userId}`}
                            className="text-sm font-medium text-foreground hover:text-primary hover:underline"
                          >
                            {c.fullName ?? '—'}
                          </Link>
                        </td>
                        <td className="px-4 py-2.5">
                          <Badge variant={LEVEL_TONE[level] ?? 'outline'}>
                            {level === 0 ? 'Unverified' : `Level ${level}`}
                          </Badge>
                        </td>
                        <td className="max-w-[180px] truncate px-4 py-2.5 text-xs">
                          {(c.coverageAreas ?? []).slice(0, 2).join(', ') ||
                            '—'}
                        </td>
                        <td className="px-4 py-2.5 text-right text-xs">
                          {c.clerkJobsCompleted ?? 0}
                        </td>
                        <td className="px-4 py-2.5 text-right text-xs">
                          {c.clerkRating
                            ? Number(c.clerkRating).toFixed(1)
                            : '—'}
                        </td>
                        <td className="px-4 py-2.5 text-xs">
                          <ExpiryDate value={c.dbsExpiry} />
                        </td>
                        <td className="px-4 py-2.5 text-xs">
                          <ExpiryDate value={c.insuranceExpiry} />
                        </td>
                        <td className="px-4 py-2.5">
                          <Badge variant={STATUS_TONE[status]}>
                            {STATUS_LABEL[status]}
                          </Badge>
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <Link
                            href={`/admin/clerks/${c.userId}`}
                            className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-background px-2.5 text-xs transition-colors hover:bg-muted"
                          >
                            <Eye className="h-3.5 w-3.5" />
                            View
                          </Link>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function ExpiryDate({ value }: { value: string | null }) {
  if (!value) return <span className="text-muted-foreground">—</span>
  const expiringSoon = isExpiringSoon(value)
  return (
    <span
      className={
        expiringSoon ? 'font-medium text-destructive' : 'text-muted-foreground'
      }
    >
      {formatDateOnly(value)}
    </span>
  )
}

function isExpiringSoon(ymd: string): boolean {
  const expiry = new Date(ymd).getTime()
  const now = Date.now()
  return expiry - now < EXPIRY_WINDOW_DAYS * 24 * 60 * 60 * 1000
}

function formatDateOnly(ymd: string): string {
  return new Date(ymd).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}
