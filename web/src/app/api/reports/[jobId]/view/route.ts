import { and, eq } from 'drizzle-orm'
import { db, jobs, organisationMembers } from '@/db'
import { getSession } from '@/lib/dal'
import { signStoredAssetUrl } from '@/lib/storage/download'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SIGNED_TTL_SECONDS = 60 * 60 // 1 hour

type Params = Promise<{ jobId: string }>

/**
 * GET /api/reports/[jobId]/view — authorize the caller against the job, then
 * 302-redirect to a freshly signed URL for the job's report PDF.
 *
 * Why this exists: `generated-reports` is a *private* bucket
 * (`sql/generated_reports_bucket.sql`), but the stored `jobs.report_url` is a
 * public-form URL that 404s ("Bucket not found"). Every viewer
 * (clerk/client/worker/admin) now links here instead of the raw URL, so a
 * single place handles authorization + short-lived signing. The signed URL
 * expires, so the redirect is marked `no-store`.
 *
 * Authorization mirrors the bucket's storage RLS: admin, the assigned clerk,
 * the owning client/creator, or an active member of the job's organisation.
 */
export async function GET(_req: Request, { params }: { params: Params }) {
  const session = await getSession()
  if (!session) return new Response('Unauthorized', { status: 401 })

  const { jobId } = await params

  const [job] = await db
    .select({
      clientId: jobs.clientId,
      clerkId: jobs.clerkId,
      createdByUserId: jobs.createdByUserId,
      organisationId: jobs.organisationId,
      reportUrl: jobs.reportUrl,
    })
    .from(jobs)
    .where(eq(jobs.id, jobId))
    .limit(1)

  if (!job || !job.reportUrl) {
    return new Response('Report not found', { status: 404 })
  }

  const uid = session.userId
  let allowed =
    session.roles.includes('admin') ||
    job.clerkId === uid ||
    job.clientId === uid ||
    job.createdByUserId === uid

  if (!allowed && job.organisationId) {
    const [member] = await db
      .select({ id: organisationMembers.id })
      .from(organisationMembers)
      .where(
        and(
          eq(organisationMembers.organisationId, job.organisationId),
          eq(organisationMembers.userId, uid),
          eq(organisationMembers.status, 'active')
        )
      )
      .limit(1)
    allowed = Boolean(member)
  }

  if (!allowed) return new Response('Forbidden', { status: 403 })

  const signed = await signStoredAssetUrl(job.reportUrl, SIGNED_TTL_SECONDS)
  if (!signed) {
    return new Response('Could not generate report link', { status: 500 })
  }

  return new Response(null, {
    status: 302,
    headers: { Location: signed, 'Cache-Control': 'no-store' },
  })
}
