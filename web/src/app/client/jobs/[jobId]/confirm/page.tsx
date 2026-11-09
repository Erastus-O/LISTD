import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ArrowLeft, ClipboardCheck } from 'lucide-react'
import { and, asc, eq } from 'drizzle-orm'
import {
  jobs,
  organisationMembers,
  properties,
  tenantDetails,
  withServiceRole,
} from '@/db'
import { requireRole } from '@/lib/dal'
import { ConfirmDetailsForm } from './confirm-details-form'

export const metadata = { title: 'Confirm details' }
export const dynamic = 'force-dynamic'

const ACK_STATUSES = ['published', 'accepted', 'assigned', 'in_progress']

type Props = { params: Promise<{ jobId: string }> }

/**
 * "Confirm tenant details & access instructions" surface — the destination for
 * the matching dashboard pending action. The creator (owner/worker) or an org
 * owner can edit the tenant list + access notes and acknowledge the brief.
 */
export default async function ConfirmDetailsPage({ params }: Props) {
  const session = await requireRole('client', 'admin')
  const { jobId } = await params

  const data = await withServiceRole(async (tx) => {
    const [job] = await tx
      .select({
        status: jobs.status,
        clientId: jobs.clientId,
        createdByUserId: jobs.createdByUserId,
        organisationId: jobs.organisationId,
        specialInstructions: jobs.specialInstructions,
        address: properties.addressLine1,
        city: properties.city,
      })
      .from(jobs)
      .leftJoin(properties, eq(properties.id, jobs.propertyId))
      .where(eq(jobs.id, jobId))
      .limit(1)
    if (!job) return { kind: 'not_found' as const }

    const isAdmin = session.roles.includes('admin')
    const isCreator =
      job.createdByUserId === session.userId ||
      job.clientId === session.userId
    let isOwner = false
    if (job.organisationId) {
      const [m] = await tx
        .select({ orgRole: organisationMembers.orgRole })
        .from(organisationMembers)
        .where(
          and(
            eq(organisationMembers.userId, session.userId),
            eq(organisationMembers.organisationId, job.organisationId),
            eq(organisationMembers.status, 'active')
          )
        )
        .limit(1)
      isOwner = m?.orgRole === 'owner'
    }
    if (!isAdmin && !isCreator && !isOwner) return { kind: 'not_found' as const }

    const tenants = await tx
      .select({
        fullName: tenantDetails.fullName,
        email: tenantDetails.email,
        phone: tenantDetails.phone,
      })
      .from(tenantDetails)
      .where(eq(tenantDetails.jobId, jobId))
      .orderBy(asc(tenantDetails.tenantOrder))

    return { kind: 'ok' as const, job, tenants }
  })

  if (data.kind === 'not_found') notFound()
  // Already confirmed or past the window — nothing to do here.
  if (!ACK_STATUSES.includes(data.job.status)) redirect('/client/actions')

  const address =
    data.job.address && data.job.city
      ? `${data.job.address}, ${data.job.city}`
      : data.job.address ?? 'this property'

  const initialTenants = data.tenants.map((t) => ({
    fullName: t.fullName ?? '',
    email: t.email ?? '',
    phone: t.phone ?? '',
  }))

  return (
    <main className="mx-auto max-w-2xl space-y-6 px-6 py-10">
      <div>
        <Link
          href="/client/actions"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to actions
        </Link>
        <h1 className="mt-3 flex items-center gap-2 font-display text-3xl text-foreground">
          <ClipboardCheck className="h-6 w-6 text-primary" />
          Confirm details
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {address} — review the tenant details and tell your clerk how to get
          in, then confirm.
        </p>
      </div>

      <ConfirmDetailsForm
        jobId={jobId}
        initialTenants={initialTenants}
        initialAccessInstructions={data.job.specialInstructions ?? ''}
      />
    </main>
  )
}
