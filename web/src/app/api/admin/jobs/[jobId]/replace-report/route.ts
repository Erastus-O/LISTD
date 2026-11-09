import { eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { errorResponse, notFound, ok } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import { jobs, withServiceRole } from '@/db'
import { callerIp, callerUserAgent, logAuditEvent } from '@/lib/audit'

export const maxDuration = 15
export const runtime = 'nodejs'

const RequestSchema = z
  .object({
    /** Public URL of the new PDF (admin uploads direct to Supabase storage,
     *  then POSTs the URL — same browser-direct pattern the clerk uses). */
    reportUrl: z.string().url().max(2000),
    storagePath: z.string().trim().min(1).max(500),
    /** Optional rationale carried in the audit row. */
    reason: z.string().trim().max(500).optional(),
  })
  .strict()

type Params = Promise<{ jobId: string }>

/**
 * POST /api/admin/jobs/[jobId]/replace-report — admin supersedes a job's
 * `report_url` with a freshly uploaded PDF. Used when the clerk-uploaded
 * file needs to be replaced (corrupt, wrong file, redacted version).
 *
 * Atomic in one tx:
 *   - Updates `jobs.report_url` to the new public URL.
 *   - Writes `tenant_portal_access/signed_pdf.replaced` audit row with
 *     before/after URLs + storage path + reason. (Reusing the
 *     `tenant_portal_access` category since this is a PDF supersede event
 *     symmetric with the S3b signed-PDF rendering pipeline; both write
 *     against the same forensic surface.)
 *
 * Out of scope: doesn't delete the previous PDF from storage — supersede
 * + retain mirrors the M3 #7 convention. The original stays at its
 * original key for audit reconstruction.
 */
export async function POST(req: Request, { params }: { params: Params }) {
  const session = await authorizeRequest('admin')
  if (session instanceof Response) return session

  try {
    const { jobId } = await params
    const body = RequestSchema.parse(await req.json())
    const ip = callerIp(req)
    const ua = callerUserAgent(req)

    const result = await withServiceRole(async (tx) => {
      const [job] = await tx
        .select({
          id: jobs.id,
          previousReportUrl: jobs.reportUrl,
        })
        .from(jobs)
        .where(eq(jobs.id, jobId))
        .limit(1)
      if (!job) return { status: 'not_found' as const }

      await tx
        .update(jobs)
        .set({
          reportUrl: body.reportUrl,
          updatedAt: sql`now()`,
        })
        .where(eq(jobs.id, jobId))

      await logAuditEvent(tx, {
        category: 'tenant_portal_access',
        action: 'signed_pdf.replaced',
        actorUserId: session.userId,
        targetType: 'job',
        targetId: jobId,
        payload: {
          previousReportUrl: job.previousReportUrl,
          newReportUrl: body.reportUrl,
          storagePath: body.storagePath,
          reason: body.reason ?? null,
          via: 'admin_replace',
        },
        ipAddress: ip,
        userAgent: ua,
      })

      return { status: 'ok' as const }
    })

    if (result.status === 'not_found') return notFound('Job not found')
    return ok({ success: true })
  } catch (err) {
    console.error('[admin/jobs/replace-report] error:', err)
    return errorResponse(err)
  }
}
