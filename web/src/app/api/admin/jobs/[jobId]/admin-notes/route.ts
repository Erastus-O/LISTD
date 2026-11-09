import { eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { errorResponse, notFound, ok } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import { jobs, withServiceRole } from '@/db'
import { callerIp, callerUserAgent, logAuditEvent } from '@/lib/audit'

export const maxDuration = 10
export const runtime = 'nodejs'

const RequestSchema = z
  .object({
    adminNotes: z.string().trim().max(8000).nullable(),
  })
  .strict()

type Params = Promise<{ jobId: string }>

/**
 * POST /api/admin/jobs/[jobId]/admin-notes — admin saves their private
 * working notes on a job (`jobs.admin_notes`, added in migration 0008).
 *
 * Atomic in one tx:
 *   - Updates `admin_notes` (null clears).
 *   - Writes a `pricing_override/admin_notes.updated` audit row carrying a
 *     before/after preview (first 200 chars each side) so admins can see who
 *     last edited a note in the audit-events stream. We re-use the
 *     `pricing_override` category because it's already the umbrella for
 *     "admin edits non-lifecycle fields with reason"; a follow-up can
 *     extract a dedicated category once we have a second such field.
 */
export async function POST(req: Request, { params }: { params: Params }) {
  const session = await authorizeRequest('admin')
  if (session instanceof Response) return session

  try {
    const { jobId } = await params
    const body = RequestSchema.parse(await req.json())
    const next = body.adminNotes?.trim() || null
    const ip = callerIp(req)
    const ua = callerUserAgent(req)

    const result = await withServiceRole(async (tx) => {
      const [job] = await tx
        .select({ id: jobs.id, adminNotes: jobs.adminNotes })
        .from(jobs)
        .where(eq(jobs.id, jobId))
        .limit(1)
      if (!job) return { status: 'not_found' as const }

      const previous = job.adminNotes ?? null
      if (previous === next) {
        return { status: 'noop' as const }
      }

      await tx
        .update(jobs)
        .set({ adminNotes: next, updatedAt: sql`now()` })
        .where(eq(jobs.id, jobId))

      await logAuditEvent(tx, {
        category: 'pricing_override',
        action: 'admin_notes.updated',
        actorUserId: session.userId,
        targetType: 'job',
        targetId: jobId,
        payload: {
          field: 'admin_notes',
          previousPreview: preview(previous),
          nextPreview: preview(next),
          cleared: next === null,
        },
        ipAddress: ip,
        userAgent: ua,
      })

      return { status: 'ok' as const }
    })

    if (result.status === 'not_found') return notFound('Job not found')
    return ok({ success: true, noop: result.status === 'noop' })
  } catch (err) {
    console.error('[admin/jobs/admin-notes] error:', err)
    return errorResponse(err)
  }
}

function preview(s: string | null): string | null {
  if (s === null) return null
  return s.length > 200 ? `${s.slice(0, 200)}…` : s
}
