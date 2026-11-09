import { and, eq } from 'drizzle-orm'
import { errorResponse, forbidden, notFound, ok } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import { jobs, organisationMembers, withServiceRole } from '@/db'
import { refreshEscrowCheckoutForJob } from '@/lib/billing/escrow'

export const runtime = 'nodejs'

type Params = Promise<{ jobId: string }>

/**
 * POST /api/client/jobs/[jobId]/payment-link — mint a fresh Stripe payment
 * link for a job that's awaiting the org owner's payment (owner-pays-via-link
 * flow). Owner-only (admins too). Lets the owner pay even after the original
 * link has expired.
 */
export async function POST(_req: Request, { params }: { params: Params }) {
  const session = await authorizeRequest('client', 'admin')
  if (session instanceof Response) return session

  try {
    const { jobId } = await params
    const isAdmin = session.roles.includes('admin')

    const allowed = await withServiceRole(async (tx) => {
      const [job] = await tx
        .select({ organisationId: jobs.organisationId })
        .from(jobs)
        .where(eq(jobs.id, jobId))
        .limit(1)
      if (!job?.organisationId) return false
      if (isAdmin) return true
      const [membership] = await tx
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
      return membership?.orgRole === 'owner'
    })
    if (!allowed) {
      return forbidden('Only the organisation owner can pay for this job.')
    }

    const result = await refreshEscrowCheckoutForJob(jobId)
    if (!result) {
      return notFound('This job is not awaiting payment.')
    }
    return ok({ url: result.url })
  } catch (err) {
    return errorResponse(err)
  }
}
