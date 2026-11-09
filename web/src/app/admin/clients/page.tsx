import Link from 'next/link'
import { ChevronLeft, ChevronRight, Eye } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { requireRole } from '@/lib/dal'
import {
  loadAdminClientsList,
  parseAdminClientsFilter,
  type AdminClientListRow,
} from '@/lib/dashboard/admin-clients'
import { AdminClientsSearch } from './_components/admin-clients-search'

export const metadata = { title: 'Admin · Clients' }

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

const STATUS_LABEL: Record<string, string> = {
  active: 'Active',
  suspended: 'Suspended',
  deleted: 'Deleted',
}

const STATUS_TONE: Record<
  string,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  active: 'secondary',
  suspended: 'destructive',
  deleted: 'outline',
}

/**
 * Admin Clients list (S6d). Layout matches the Lovable AdminClients table:
 * Name · Email · Organisation · Jobs · Last Active · Status · View action.
 *
 * Out of scope: status transitions (Suspend/Reactivate/Delete) — deferred
 * until a `profiles.account_status` schema migration + dedicated audit
 * category land. The Status column always reads "Active" today.
 */
export default async function AdminClientsPage({ searchParams }: Props) {
  await requireRole('admin')
  const sp = await searchParams
  const filter = parseAdminClientsFilter(sp)
  const { rows, total, page, pageSize, orgOptions } =
    await loadAdminClientsList(filter)

  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const baseQs = new URLSearchParams()
  if (filter.q) baseQs.set('q', filter.q)
  if (filter.status) baseQs.set('status', filter.status)
  if (filter.orgId) baseQs.set('orgId', filter.orgId)
  const pageHref = (n: number) => {
    const next = new URLSearchParams(baseQs.toString())
    if (n > 0) next.set('page', String(n))
    const qs = next.toString()
    return qs ? `/admin/clients?${qs}` : '/admin/clients'
  }

  return (
    <div className="w-full space-y-6 px-6 py-10">
      <div>
        <h1 className="font-display text-3xl text-foreground">Clients</h1>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <AdminClientsSearch orgOptions={orgOptions} />
        <span className="text-xs text-muted-foreground">
          {total} {total === 1 ? 'client' : 'clients'}
        </span>
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No clients match this filter.
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
                    <th className="px-4 py-2.5 text-left font-medium">Email</th>
                    <th className="px-4 py-2.5 text-left font-medium">Organisation</th>
                    <th className="px-4 py-2.5 text-right font-medium">Jobs</th>
                    <th className="px-4 py-2.5 text-left font-medium">Last active</th>
                    <th className="px-4 py-2.5 text-left font-medium">Status</th>
                    <th className="px-4 py-2.5 text-right font-medium" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((c) => (
                    <ClientRow key={c.userId} client={c} />
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            Page {page + 1} of {totalPages}
          </span>
          <div className="flex gap-2">
            {page > 0 ? (
              <Link
                href={pageHref(page - 1)}
                className="inline-flex h-8 items-center gap-1 rounded-md border border-border bg-background px-3 transition-colors hover:bg-muted"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                Previous
              </Link>
            ) : (
              <span className="inline-flex h-8 cursor-not-allowed items-center gap-1 rounded-md border border-border bg-muted/30 px-3 text-muted-foreground/50">
                <ChevronLeft className="h-3.5 w-3.5" />
                Previous
              </span>
            )}
            {page + 1 < totalPages ? (
              <Link
                href={pageHref(page + 1)}
                className="inline-flex h-8 items-center gap-1 rounded-md border border-border bg-background px-3 transition-colors hover:bg-muted"
              >
                Next
                <ChevronRight className="h-3.5 w-3.5" />
              </Link>
            ) : (
              <span className="inline-flex h-8 cursor-not-allowed items-center gap-1 rounded-md border border-border bg-muted/30 px-3 text-muted-foreground/50">
                Next
                <ChevronRight className="h-3.5 w-3.5" />
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function ClientRow({ client }: { client: AdminClientListRow }) {
  const name = client.fullName ?? client.companyName ?? '—'
  return (
    <tr className="hover:bg-muted/30">
      <td className="px-4 py-2.5">
        <Link
          href={`/admin/clients/${client.userId}`}
          className="text-sm font-medium text-foreground hover:text-primary hover:underline"
        >
          {name}
        </Link>
      </td>
      <td className="max-w-[220px] truncate px-4 py-2.5 text-xs text-muted-foreground">
        {client.email ?? '—'}
      </td>
      <td className="max-w-[180px] truncate px-4 py-2.5 text-xs">
        {client.organisation?.name ?? '—'}
      </td>
      <td className="px-4 py-2.5 text-right text-xs">{client.jobsCount}</td>
      <td className="px-4 py-2.5 text-xs text-muted-foreground">
        {formatDate(client.lastActiveAt ?? client.createdAt)}
      </td>
      <td className="px-4 py-2.5">
        <Badge
          variant={STATUS_TONE[client.status] ?? 'outline'}
          className="capitalize"
        >
          {STATUS_LABEL[client.status] ?? client.status}
        </Badge>
      </td>
      <td className="px-4 py-2.5 text-right">
        <Link
          href={`/admin/clients/${client.userId}`}
          className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-background px-2.5 text-xs transition-colors hover:bg-muted"
        >
          <Eye className="h-3.5 w-3.5" />
          View
        </Link>
      </td>
    </tr>
  )
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: '2-digit',
  })
}
