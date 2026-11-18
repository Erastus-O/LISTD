import { and, eq, inArray } from 'drizzle-orm'
import { startBlock } from '@/lib/listd/on-site'
import { conflict, errorResponse, ok } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import { jobs, withServiceRole } from '@/db'
import { callerIp, callerUserAgent, logAuditEvent } from '@/lib/audit'

export const maxDuration = 15
export const runtime = 'nodejs'

type Params = Promise<{ jobId: string }>

/** POST /api/cleaner/jobs/[jobId]/start — accepted → in_progress (cleaner on site). */
export async function POST(req: Request, { params }: { params: Params }) {
  const session = await authorizeRequest('cleaner', 'admin')
  if (session instanceof Response) return session

  try {
    const { jobId } = await params
    const result = await withServiceRole(async (tx) => {
      const blocked = await startBlock(tx, jobId, session.roles.includes('admin'))
      if (blocked) return { ok: false as const, message: blocked }
      const updated = await tx
        .update(jobs)
        .set({ status: 'in_progress' })
        .where(
          and(
            eq(jobs.id, jobId),
            eq(jobs.cleanerId, session.userId),
            inArray(jobs.status, ['accepted', 'assigned'])
          )
        )
        .returning({ id: jobs.id })
      if (updated.length === 0) return { ok: false as const, message: 'Job is not in an acceptable state to start.' }

      await logAuditEvent(tx, {
        category: 'job_lifecycle',
        action: 'job.in_progress',
        actorUserId: session.userId,
        targetType: 'job',
        targetId: jobId,
        payload: { service: 'cleaning' },
        ipAddress: callerIp(req),
        userAgent: callerUserAgent(req),
      })
      return { ok: true as const }
    })

    if (!result.ok) {
      return conflict(result.message)
    }
    return ok({ success: true })
  } catch (err) {
    console.error('[cleaner/jobs/start] error:', err)
    return errorResponse(err)
  }
}
