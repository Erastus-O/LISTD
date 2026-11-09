import { eq } from 'drizzle-orm'
import { z } from 'zod'
import {
  badRequest,
  created,
  errorResponse,
  notFound,
} from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import { db, jobs } from '@/db'
import {
  issueShareToken,
  listShareTokensForJob,
} from '@/lib/report-share-tokens'

export const maxDuration = 15
export const runtime = 'nodejs'

const RequestSchema = z
  .object({
    label: z.string().trim().max(120).nullable().optional(),
    ttlDays: z.union([z.literal(1), z.literal(7), z.literal(30), z.literal(90)]),
    maxViews: z.number().int().positive().max(1000).nullable().optional(),
  })
  .strict()

type Params = { params: Promise<{ jobId: string }> }

/**
 * POST /api/admin/reports/[jobId]/share — admin issues a new shareable
 * link. Returns the raw token + the public URL the admin should send.
 * Rejected if the job has no `report_url` (nothing to share yet).
 *
 * GET — list every share token (active + revoked + expired) for the
 * job, used by the management dialog on the admin reports page.
 */
export async function POST(req: Request, { params }: Params) {
  const session = await authorizeRequest('admin')
  if (session instanceof Response) return session

  try {
    const { jobId } = await params
    const body = RequestSchema.parse(await req.json())

    const [job] = await db
      .select({ id: jobs.id, reportUrl: jobs.reportUrl })
      .from(jobs)
      .where(eq(jobs.id, jobId))
      .limit(1)
    if (!job) return notFound('Job not found')
    if (!job.reportUrl) {
      return badRequest(
        'This job has no report PDF yet : wait for the clerk to submit.'
      )
    }

    const result = await issueShareToken({
      jobId,
      label: body.label?.trim() || null,
      ttlDays: body.ttlDays,
      maxViews: body.maxViews ?? null,
      issuedBy: session.userId,
    })

    const origin = new URL(req.url).origin
    return created({
      token: result.token,
      shareUrl: `${origin}/reports/share/${result.token}`,
      expiresAt: result.row.expiresAt,
    })
  } catch (err) {
    console.error('[admin/reports/:jobId/share POST] error:', err)
    return errorResponse(err)
  }
}

export async function GET(_req: Request, { params }: Params) {
  const session = await authorizeRequest('admin')
  if (session instanceof Response) return session

  try {
    const { jobId } = await params
    const rows = await listShareTokensForJob(jobId)
    // Don't leak the raw `token` to admins — they had it on issue, and
    // surfacing it later would let any admin re-share without a fresh
    // audit row. Strip it here.
    return Response.json({
      rows: rows.map((r) => ({
        id: r.id,
        label: r.label,
        expiresAt: r.expiresAt,
        maxViews: r.maxViews,
        viewCount: r.viewCount,
        lastViewedAt: r.lastViewedAt,
        revokedAt: r.revokedAt,
        revokedReason: r.revokedReason,
        createdAt: r.createdAt,
        issuedBy: r.issuedBy,
      })),
    })
  } catch (err) {
    console.error('[admin/reports/:jobId/share GET] error:', err)
    return errorResponse(err)
  }
}
