import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  ArrowLeft,
  Bell,
  Briefcase,
  Building2,
  FileText,
  Plus,
  ScrollText,
  User,
  Users,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { AdminNotesEditor } from '@/components/admin/admin-notes-editor'
import { ProfileAvatar } from '@/components/role/profile-avatar'
import { requireRole } from '@/lib/dal'
import { loadAdminClientDetail } from '@/lib/dashboard/admin-clients'
import { STATUS_BADGE_TONE } from '@/lib/dashboard/admin-jobs'
import {
  INSPECTION_TYPE_LABELS,
  type InspectionType,
} from '@/lib/pricing-matrix'
import { ClientAdminActions } from './client-actions'

type Props = { params: Promise<{ clientId: string }> }

export const metadata = { title: 'Admin · Client detail' }

/** Mirror of the tones used on the admin Invoices list (`/admin/invoices`). */
const INVOICE_STATUS_TONE: Record<
  string,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  draft: 'outline',
  issued: 'default',
  sent: 'default',
  paid: 'secondary',
  overdue: 'destructive',
  void: 'destructive',
}

/**
 * Admin Client detail (S6d of the Lovable port). Server-rendered read view
 * — profile, organisation context, members of the same org, recent jobs
 * (capped at 50), notification preferences. Mutating actions:
 *
 *   - Impersonation — the audit-wired button from M1 #22 Package B (S6a
 *     wired the clerk-side; this is the parallel client-side entry point).
 *   - (Deferred) Suspend / Reactivate / Soft-delete — wait on
 *     `profiles.account_status` schema migration + audit category.
 *   - (Deferred) Inline edit of name / phone — wait on a profile-update
 *     audit handler.
 */
export default async function AdminClientDetailPage({ params }: Props) {
  await requireRole('admin')
  const { clientId } = await params
  const client = await loadAdminClientDetail(clientId)
  if (!client) notFound()

  const displayName =
    client.fullName ?? client.companyName ?? '(unnamed client)'

  return (
    <div className="w-full space-y-6 px-6 py-10">
      <Link
        href="/admin/clients"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to clients
      </Link>

      <div className="flex flex-wrap items-center gap-4">
        <ProfileAvatar
          url={client.avatarUrl}
          name={client.fullName ?? client.companyName}
          emailFallback={client.email}
          size="lg"
        />
        <h1 className="font-display text-3xl text-foreground">{displayName}</h1>
        <Badge
          variant={
            client.accountStatus === 'active'
              ? 'secondary'
              : client.accountStatus === 'suspended'
                ? 'destructive'
                : 'outline'
          }
          className="capitalize"
        >
          {client.accountStatus}
        </Badge>
        {client.isSuperAdmin && (
          <Badge variant="destructive">Super admin</Badge>
        )}
        <Link
          href={`/book?clientId=${client.userId}`}
          className="ml-auto inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <Plus className="h-3.5 w-3.5" />
          Book a job for this client
        </Link>
        <Link
          href={`/admin/clients/${client.userId}/statement`}
          className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
        >
          <ScrollText className="h-3.5 w-3.5" />
          View statement
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        {/* LEFT — profile + actions */}
        <div className="space-y-6">
          <Card>
            <CardContent className="space-y-3 p-6 text-sm">
              <h2 className="flex items-center gap-1.5 text-sm font-semibold">
                <User className="h-4 w-4" />
                Profile
              </h2>
              <Detail label="Name">{client.fullName ?? '—'}</Detail>
              <Detail label="Email">{client.email ?? '—'}</Detail>
              <Detail label="Phone">{client.phone ?? '—'}</Detail>
              {client.companyName && (
                <Detail label="Company">{client.companyName}</Detail>
              )}
              <Detail label="Joined">{formatDate(client.createdAt)}</Detail>
            </CardContent>
          </Card>

          <ClientAdminActions
            clientId={client.userId}
            clientName={client.fullName ?? client.companyName ?? null}
            currentStatus={client.accountStatus}
          />
        </div>

        {/* RIGHT — context */}
        <div className="space-y-6">
          {client.organisation && (
            <Card>
              <CardContent className="space-y-3 p-6 text-sm">
                <h2 className="flex items-center gap-1.5 text-sm font-semibold">
                  <Building2 className="h-4 w-4" />
                  Organisation
                </h2>
                <Detail label="Name">{client.organisation.name ?? '—'}</Detail>
                {client.organisation.billingAddress && (
                  <Detail label="Billing">
                    {client.organisation.billingAddress}
                  </Detail>
                )}
                {client.organisation.vatNumber && (
                  <Detail label="VAT">{client.organisation.vatNumber}</Detail>
                )}
              </CardContent>
            </Card>
          )}

          {client.organisation && client.organisationMembers.length > 0 && (
            <Card>
              <CardContent className="space-y-3 p-6">
                <h2 className="flex items-center gap-1.5 text-sm font-semibold">
                  <Users className="h-4 w-4" />
                  Organisation members ({client.organisationMembers.length})
                </h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="border-b border-border text-[10px] uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th className="px-2 py-2 text-left font-medium">Name</th>
                        <th className="px-2 py-2 text-left font-medium">Role</th>
                        <th className="px-2 py-2 text-left font-medium">Status</th>
                        <th className="px-2 py-2 text-left font-medium">
                          Last Active
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {client.organisationMembers.map((m) => (
                        <tr key={m.membershipId} className="hover:bg-muted/30">
                          <td className="px-2 py-2 font-medium">
                            {m.fullName ?? '—'}
                          </td>
                          <td className="px-2 py-2 capitalize">{m.orgRole}</td>
                          <td className="px-2 py-2 capitalize">{m.status}</td>
                          <td className="px-2 py-2 text-muted-foreground">
                            {m.lastActiveAt
                              ? formatDate(m.lastActiveAt)
                              : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardContent className="space-y-3 p-6">
              <h2 className="flex items-center gap-1.5 text-sm font-semibold">
                <Briefcase className="h-4 w-4" />
                Recent jobs ({client.recentJobs.length})
              </h2>
              {client.recentJobs.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  No jobs posted by this client.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="border-b border-border text-[10px] uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th className="px-2 py-2 text-left font-medium">Ref</th>
                        <th className="px-2 py-2 text-left font-medium">Type</th>
                        <th className="px-2 py-2 text-left font-medium">Property</th>
                        <th className="px-2 py-2 text-left font-medium">Pro</th>
                        <th className="px-2 py-2 text-left font-medium">Status</th>
                        <th className="px-2 py-2 text-left font-medium">Date</th>
                        <th className="px-2 py-2 text-right font-medium">Price</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {client.recentJobs.map((j) => (
                        <tr key={j.id} className="hover:bg-muted/30">
                          <td className="px-2 py-2">
                            <Link
                              href={`/admin/jobs/${j.id}`}
                              className="font-mono text-[11px] text-primary hover:underline"
                            >
                              {j.id.slice(0, 8)}
                            </Link>
                          </td>
                          <td className="px-2 py-2 text-[11px]">
                            {INSPECTION_TYPE_LABELS[
                              j.inspectionType as InspectionType
                            ] ?? j.inspectionType}
                          </td>
                          <td className="max-w-[160px] truncate px-2 py-2">
                            {j.propertyAddress ?? '—'}
                          </td>
                          <td className="px-2 py-2">
                            {j.clerkFullName ?? (
                              <span className="text-muted-foreground">
                                Unassigned
                              </span>
                            )}
                          </td>
                          <td className="px-2 py-2">
                            <Badge
                              variant={
                                STATUS_BADGE_TONE[
                                  j.status as keyof typeof STATUS_BADGE_TONE
                                ] ?? 'outline'
                              }
                              className="text-[10px]"
                            >
                              {j.status.replace(/_/g, ' ')}
                            </Badge>
                          </td>
                          <td className="px-2 py-2">{j.scheduledDate}</td>
                          <td className="px-2 py-2 text-right">
                            {j.quotedPrice
                              ? `£${Number(j.quotedPrice).toFixed(2)}`
                              : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-3 p-6">
              <div className="flex items-center justify-between gap-2">
                <h2 className="flex items-center gap-1.5 text-sm font-semibold">
                  <FileText className="h-4 w-4" />
                  Invoices ({client.invoices.length})
                </h2>
                <Link
                  href="/admin/invoices/new"
                  className="text-xs text-primary hover:underline"
                >
                  New invoice
                </Link>
              </div>
              {client.invoices.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  No invoices for this client yet.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="border-b border-border text-[10px] uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th className="px-2 py-2 text-left font-medium">Reference</th>
                        <th className="px-2 py-2 text-left font-medium">Issued</th>
                        <th className="px-2 py-2 text-left font-medium">Due</th>
                        <th className="px-2 py-2 text-left font-medium">Status</th>
                        <th className="px-2 py-2 text-right font-medium">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {client.invoices.map((inv) => (
                        <tr key={inv.id} className="hover:bg-muted/30">
                          <td className="px-2 py-2">
                            <Link
                              href={`/admin/invoices/${inv.id}`}
                              className="font-mono text-[11px] text-primary hover:underline"
                            >
                              {inv.reference ?? inv.id.slice(0, 8)}
                            </Link>
                            {inv.kind !== 'invoice' && (
                              <span className="ml-1 text-[10px] text-muted-foreground">
                                (credit note)
                              </span>
                            )}
                          </td>
                          <td className="px-2 py-2">
                            {inv.issueDate ? formatDate(inv.issueDate) : '—'}
                          </td>
                          <td className="px-2 py-2">
                            {inv.dueDate ? formatDate(inv.dueDate) : '—'}
                          </td>
                          <td className="px-2 py-2">
                            <Badge
                              variant={INVOICE_STATUS_TONE[inv.status] ?? 'outline'}
                              className="text-[10px] capitalize"
                            >
                              {inv.status}
                            </Badge>
                          </td>
                          <td className="px-2 py-2 text-right">
                            {formatMoney(inv.total, inv.currency)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-2 p-6">
              <h2 className="flex items-center gap-1.5 text-sm font-semibold">
                <ScrollText className="h-4 w-4" />
                Admin notes (internal)
              </h2>
              <p className="text-[11px] text-muted-foreground">
                Visible to admin staff only: not surfaced to the client.
              </p>
              <AdminNotesEditor
                endpoint={`/api/admin/clients/${client.userId}/admin-notes`}
                initial={client.adminNotes}
                placeholder="Internal notes about this client…"
              />
            </CardContent>
          </Card>

          {client.notificationPreferences.length > 0 && (
            <Card>
              <CardContent className="space-y-3 p-6">
                <h2 className="flex items-center gap-1.5 text-sm font-semibold">
                  <Bell className="h-4 w-4" />
                  Notification preferences (read-only)
                </h2>
                <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
                  {client.notificationPreferences.map((p) => (
                    <div key={p.key} className="flex items-center gap-1.5">
                      <span
                        className={`h-2 w-2 rounded-full ${
                          p.enabled ? 'bg-emerald-500' : 'bg-muted'
                        }`}
                      />
                      <span className="text-muted-foreground">
                        {humaniseKey(p.key)}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}

function Detail({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="grid grid-cols-[80px_1fr] gap-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm">{children}</span>
    </div>
  )
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function formatMoney(amount: string, currency: string): string {
  const n = Number(amount)
  try {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency,
    }).format(Number.isFinite(n) ? n : 0)
  } catch {
    return `${currency} ${(Number.isFinite(n) ? n : 0).toFixed(2)}`
  }
}

function humaniseKey(camel: string): string {
  // e.g. emailJobUpdates -> Email job updates
  const spaced = camel.replace(/([A-Z])/g, ' $1').toLowerCase()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}
