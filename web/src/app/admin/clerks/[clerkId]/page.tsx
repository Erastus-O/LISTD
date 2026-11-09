import { AdminProLevelsPanel } from '@/components/listd/pro-levels-panels'
import { loadAdminProLevels } from '@/lib/listd/pro-levels'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { eq } from 'drizzle-orm'
import {
  AlertCircle,
  ArrowLeft,
  Briefcase,
  FileText,
  ShieldCheck,
  Star,
  User,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { ProfileAvatar } from '@/components/role/profile-avatar'
import { profiles, userRoles, withServiceRole } from '@/db'
import { requireRole } from '@/lib/dal'
import { loadAdminClerkPanels } from '@/lib/dashboard/admin-clerk-detail'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { INSPECTION_TYPE_LABELS, type InspectionType } from '@/lib/pricing-matrix'
import { ClerkAdminActions } from './admin-actions'
import { AdminNotesForm } from './admin-notes-form'
import { BadgeControl } from './badge-control'
import { ClerkVerificationForm } from './verification-form'

type Props = { params: Promise<{ clerkId: string }> }

const STATUS_LABEL: Record<string, string> = {
  unverified: 'Unverified',
  pending_verification: 'Pending review',
  verified: 'Verified',
  rejected: 'Rejected',
  suspended: 'Suspended',
}

const ACCOUNT_STATUS_LABEL: Record<string, string> = {
  active: 'Active',
  suspended: 'Suspended',
  deleted: 'Deleted',
}

const JOB_STATUS_TONE: Record<
  string,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  cancelled: 'destructive',
  completed: 'secondary',
  paid: 'secondary',
  signed: 'secondary',
  accepted: 'default',
  assigned: 'default',
  in_progress: 'default',
  submitted: 'default',
  reviewed: 'default',
  draft: 'outline',
  pending: 'outline',
  published: 'outline',
}

/**
 * Admin Clerk Detail (M1 #7 + Lovable layout port). Two-column layout
 * matches Lovable's AdminClerkDetail:
 *
 *   Left:  Account Details · Verification Documents · Badge Control ·
 *          Earnings History (with stats) · Quality Reviews
 *   Right: Admin Actions · Incidents & Strikes · Admin Notes
 *          + ClerkVerificationForm when status = pending_verification
 *
 * Document signed-URLs use a 1h TTL — tighter than the previous version
 * isn't necessary since admins explicitly open them in a new tab. Per-doc
 * preview rather than a generic "view all" keeps each download auditable.
 */
export default async function AdminClerkDetailPage({ params }: Props) {
  await requireRole('admin')
  const { clerkId } = await params
  const levelsPanel = await loadAdminProLevels(clerkId)

  const { clerk, roles } = await withServiceRole(async (tx) => {
    const [row] = await tx
      .select()
      .from(profiles)
      .where(eq(profiles.userId, clerkId))
      .limit(1)
    if (!row) return { clerk: null, roles: [] as string[] }
    const roleRows = await tx
      .select({ role: userRoles.role })
      .from(userRoles)
      .where(eq(userRoles.userId, clerkId))
    return { clerk: row, roles: roleRows.map((r) => r.role) }
  })
  if (!clerk) notFound()

  const panels = await loadAdminClerkPanels(clerkId)

  const supabaseAdmin = getSupabaseAdmin()
  const docPaths = {
    governmentId: clerk.governmentIdUrl,
    dbs: clerk.dbsCertificateUrl,
    qualification: parseQualification(clerk.qualification ?? null).path,
    insurance: parseInsurance(clerk.insuranceDetails ?? null).path,
  }
  const signedUrls = await Promise.all(
    Object.entries(docPaths).map(async ([key, path]) => {
      if (!path) return [key, null] as const
      const { data } = await supabaseAdmin.storage
        .from('clerk-documents')
        .createSignedUrl(path, 3600)
      return [key, data?.signedUrl ?? null] as const
    })
  )
  const signed = Object.fromEntries(signedUrls)

  const verificationStatus = clerk.verificationStatus ?? 'unverified'
  const accountStatus = (clerk.accountStatus ?? 'active') as
    | 'active'
    | 'suspended'
    | 'deleted'
  const level = clerk.clerkLevel ?? 1
  const anyDocs = Object.values(signed).some(Boolean)

  return (
    <div className="w-full space-y-6 px-6 py-10">
      <Link
        href="/admin/clerks"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back
      </Link>

      <div className="flex flex-wrap items-center gap-4">
        <ProfileAvatar
          url={clerk.avatarUrl}
          name={clerk.fullName}
          size="lg"
        />
        <h1 className="font-display text-3xl text-foreground">
          {clerk.fullName ?? '(no name)'}
        </h1>
        <Badge variant="secondary">Level {level}</Badge>
        <Badge
          variant={
            verificationStatus === 'verified'
              ? 'secondary'
              : verificationStatus === 'rejected' ||
                  verificationStatus === 'suspended'
                ? 'destructive'
                : 'default'
          }
        >
          {STATUS_LABEL[verificationStatus] ?? verificationStatus}
        </Badge>
        {accountStatus !== 'active' && (
          <Badge
            variant={
              accountStatus === 'suspended' ? 'destructive' : 'outline'
            }
          >
            Account {ACCOUNT_STATUS_LABEL[accountStatus]}
          </Badge>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        {/* LEFT — primary content */}
        <div className="space-y-6">
          {/* Account Details */}
          <Card>
            <CardContent className="space-y-4 p-6">
              <h2 className="flex items-center gap-1.5 text-base font-semibold">
                <User className="h-4 w-4" />
                Account Details
              </h2>
              <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
                <Field label="Full Name">{clerk.fullName ?? '—'}</Field>
                <Field label="Phone">{clerk.phone ?? '—'}</Field>
                <Field label="Coverage Areas">
                  {(clerk.coverageAreas ?? []).join(', ') || '—'}
                </Field>
                <Field label="Services Offered">
                  {(clerk.serviceTypesOffered ?? []).join(', ') || '—'}
                </Field>
                <Field label="Languages">
                  {(clerk.languages ?? []).join(', ') || '—'}
                </Field>
                {clerk.emergencyContactName && (
                  <Field label="Emergency Contact">
                    {clerk.emergencyContactName}
                    {clerk.emergencyContactPhone
                      ? ` · ${clerk.emergencyContactPhone}`
                      : ''}
                  </Field>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Verification Documents */}
          <Card>
            <CardContent className="space-y-3 p-6">
              <h2 className="flex items-center gap-1.5 text-base font-semibold">
                <FileText className="h-4 w-4" />
                Verification Documents
              </h2>
              {!anyDocs ? (
                <p className="text-sm text-muted-foreground">
                  No documents uploaded
                </p>
              ) : (
                <div className="space-y-3">
                  <DocRow
                    label="Government ID"
                    expiry={clerk.governmentIdExpiry}
                    signedUrl={signed.governmentId}
                  />
                  <DocRow
                    label="DBS certificate"
                    expiry={clerk.dbsExpiry}
                    signedUrl={signed.dbs}
                    expiryRequired
                  />
                  <DocRow
                    label="Qualification"
                    signedUrl={signed.qualification}
                    meta={parseQualification(clerk.qualification ?? null).kind}
                  />
                  <DocRow
                    label="Insurance"
                    expiry={clerk.insuranceExpiry}
                    signedUrl={signed.insurance}
                    meta={parseInsurance(clerk.insuranceDetails ?? null).provider}
                    expiryRequired
                  />
                </div>
              )}
            </CardContent>
          </Card>

          {/* Verification Form (only when pending review) */}
          {verificationStatus === 'pending_verification' && (
            <ClerkVerificationForm
              clerkId={clerkId}
              status={verificationStatus}
              previousReason={clerk.verificationRejectionReason ?? ''}
            />
          )}

          {/* Rejection note (if rejected) */}
          {clerk.verificationRejectionReason &&
            verificationStatus === 'rejected' && (
              <Card>
                <CardContent className="p-6">
                  <h2 className="mb-2 text-base font-semibold">
                    Rejection note
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    {clerk.verificationRejectionReason}
                  </p>
                </CardContent>
              </Card>
            )}

          {/* Badge Control */}
          <BadgeControl
            clerkId={clerkId}
            currentLevel={panels.badge.currentLevel}
            nextLevel={panels.badge.nextLevel}
            criteria={panels.badge.criteria}
            allRealCriteriaMet={panels.badge.allRealCriteriaMet}
          />

          {/* Earnings History */}
          <Card>
            <CardContent className="space-y-4 p-6">
              <h2 className="flex items-center gap-1.5 text-base font-semibold">
                <Briefcase className="h-4 w-4" />
                Earnings History
              </h2>
              <div className="grid grid-cols-3 gap-3">
                <Stat
                  label="Total Earned"
                  value={`£${panels.earningsStats.totalEarned.toFixed(2)}`}
                />
                <Stat
                  label="Jobs Completed"
                  value={String(panels.earningsStats.jobsCompleted)}
                />
                <Stat
                  label="Acceptance Rate"
                  value={
                    panels.earningsStats.acceptanceRatePercent === null
                      ? '—'
                      : `${panels.earningsStats.acceptanceRatePercent}%`
                  }
                />
              </div>

              {panels.earningsHistory.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  No jobs assigned yet.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="border-b border-border text-[10px] uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th className="px-2 py-2 text-left font-medium">Date</th>
                        <th className="px-2 py-2 text-left font-medium">
                          Job Ref
                        </th>
                        <th className="px-2 py-2 text-left font-medium">
                          Address
                        </th>
                        <th className="px-2 py-2 text-left font-medium">Type</th>
                        <th className="px-2 py-2 text-right font-medium">
                          Payout
                        </th>
                        <th className="px-2 py-2 text-left font-medium">
                          Status
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {panels.earningsHistory.map((j) => (
                        <tr key={j.id} className="hover:bg-muted/30">
                          <td className="whitespace-nowrap px-2 py-2 text-muted-foreground">
                            {formatDate(j.scheduledDate)}
                          </td>
                          <td className="px-2 py-2">
                            <Link
                              href={`/admin/jobs/${j.id}`}
                              className="font-mono text-[11px] text-primary hover:underline"
                            >
                              {j.id.slice(0, 8)}
                            </Link>
                          </td>
                          <td className="max-w-[180px] truncate px-2 py-2">
                            {j.propertyAddress
                              ? `${j.propertyAddress}${
                                  j.propertyPostcode
                                    ? ', ' + j.propertyPostcode
                                    : ''
                                }`
                              : '—'}
                          </td>
                          <td className="px-2 py-2">
                            {INSPECTION_TYPE_LABELS[
                              j.inspectionType as InspectionType
                            ] ?? j.inspectionType}
                          </td>
                          <td className="px-2 py-2 text-right">
                            {j.payout
                              ? `£${Number(j.payout).toFixed(2)}`
                              : '—'}
                          </td>
                          <td className="px-2 py-2">
                            <Badge
                              variant={
                                JOB_STATUS_TONE[j.status] ?? 'outline'
                              }
                              className="text-[10px]"
                            >
                              {j.status.replace(/_/g, ' ')}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Quality Reviews */}
          <Card>
            <CardContent className="space-y-3 p-6">
              <h2 className="flex items-center gap-1.5 text-base font-semibold">
                <Star className="h-4 w-4" />
                Quality Reviews
              </h2>
              {panels.reviewSummary.count === 0 ? (
                <p className="text-sm text-muted-foreground">No reviews yet</p>
              ) : (
                <>
                  <div className="flex items-center gap-3 text-sm">
                    <span className="font-bold text-foreground">
                      {panels.reviewSummary.averageRating?.toFixed(1) ?? '—'}
                    </span>
                    <span className="text-muted-foreground">
                      ★ from {panels.reviewSummary.count}{' '}
                      {panels.reviewSummary.count === 1 ? 'review' : 'reviews'}
                    </span>
                  </div>
                  {panels.reviewSummary.recent.length > 0 && (
                    <ul className="space-y-3 pt-2">
                      {panels.reviewSummary.recent.map((r) => (
                        <li
                          key={r.id}
                          className="space-y-1 border-b border-border/60 pb-3 last:border-b-0 last:pb-0"
                        >
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-medium">
                              {'★'.repeat(r.rating)}
                              <span className="text-muted-foreground">
                                {'★'.repeat(Math.max(0, 5 - r.rating))}
                              </span>
                            </span>
                            <span className="text-muted-foreground">
                              {formatDate(r.createdAt)}
                            </span>
                          </div>
                          {r.reviewText && (
                            <p className="text-xs text-foreground">
                              {r.reviewText}
                            </p>
                          )}
                          {r.clerkResponse && (
                            <p className="rounded-md bg-muted/40 p-2 text-[11px] italic text-muted-foreground">
                              Clerk reply: {r.clerkResponse}
                            </p>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </div>

        {/* RIGHT — actions + sidebar */}
        <div className="space-y-6">
          <AdminProLevelsPanel userId={levelsPanel.userId} roles={levelsPanel.roles} applications={levelsPanel.applications} />
          <ClerkAdminActions
            clerkId={clerkId}
            clerkName={clerk.fullName}
            currentStatus={accountStatus}
            targetRoles={roles}
          />

          <Card>
            <CardContent className="space-y-3 p-6">
              <h2 className="flex items-center gap-1.5 text-base font-semibold">
                <ShieldCheck className="h-4 w-4" />
                Incidents &amp; Strikes
              </h2>
              {panels.incidents.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No incidents recorded
                </p>
              ) : (
                <ul className="space-y-2">
                  {panels.incidents.map((i) => (
                    <li
                      key={`${i.kind}-${i.id}`}
                      className="space-y-1 rounded-md border border-border bg-muted/20 p-2.5"
                    >
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="flex items-center gap-1.5 font-medium capitalize">
                          <AlertCircle
                            className={`h-3.5 w-3.5 ${
                              i.kind === 'strike' && i.active
                                ? 'text-destructive'
                                : 'text-muted-foreground'
                            }`}
                          />
                          {i.kind} · {i.severity}
                        </span>
                        <span className="text-[11px] text-muted-foreground">
                          {formatDate(i.createdAt)}
                        </span>
                      </div>
                      {i.notes && (
                        <p className="text-[11px] text-muted-foreground">
                          {i.notes}
                        </p>
                      )}
                      {i.kind === 'strike' && !i.active && (
                        <Badge
                          variant="outline"
                          className="text-[10px] capitalize"
                        >
                          Expired
                        </Badge>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <AdminNotesForm
            userId={clerkId}
            initialNotes={clerk.adminNotes}
          />
        </div>
      </div>
    </div>
  )
}

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm text-foreground">{children}</p>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-muted/40 p-3 text-center">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-base font-bold text-foreground">{value}</p>
    </div>
  )
}

function DocRow({
  label,
  expiry,
  signedUrl,
  meta,
  expiryRequired,
}: {
  label: string
  expiry?: string | null
  signedUrl: string | null
  meta?: string | null
  expiryRequired?: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border pb-3 last:border-0 last:pb-0">
      <div>
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="text-xs text-muted-foreground">
          {meta && `${meta} · `}
          {expiry
            ? `Expires ${expiry}`
            : expiryRequired
              ? 'No expiry on file'
              : 'No expiry'}
        </p>
      </div>
      {signedUrl ? (
        <a
          href={signedUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs font-medium text-primary hover:underline"
        >
          View
        </a>
      ) : (
        <span className="text-xs text-muted-foreground">Missing</span>
      )}
    </div>
  )
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

function parseQualification(raw: string | null) {
  if (!raw) return { kind: null, path: null }
  const [kind, path] = raw.split('|')
  return { kind: kind ?? null, path: path ?? null }
}

function parseInsurance(raw: string | null) {
  if (!raw) return { provider: null, cover: null, path: null }
  const [provider, cover, path] = raw.split('|')
  return {
    provider: provider ?? null,
    cover: cover ?? null,
    path: path ?? null,
  }
}
