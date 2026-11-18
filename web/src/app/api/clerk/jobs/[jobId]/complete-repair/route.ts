import { and, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { finishBlock } from '@/lib/listd/on-site'
import { errorResponse, ok } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import { jobs, withServiceRole } from '@/db'
import { callerIp, callerUserAgent, logAuditEvent } from '@/lib/audit'

export const runtime = 'nodejs'

const Body = z.object({
  notes: z.string().trim().min(3).max(4000),
  // Photos of the area worked on; every frame the Pro kept needs one.
  areaPhotos: z
    .array(z.object({ area: z.string().trim().min(1).max(80), paths: z.array(z.string().min(1).max(500)).min(1, 'Add a photo for every area.').max(20) }))
    .min(1, 'Add photos of the area you worked on.')
    .max(20),
}).strict()

type Params = Promise<{ jobId: string }>

/**
 * POST /api/clerk/jobs/[jobId]/complete-repair: a Pro Trades finishes a repair.
 * Goes to LISTD for review (same decision route as cleaning), then to the client.
 */
export async function POST(req: Request, { params }: { params: Params }) {
  const session = await authorizeRequest('trades', 'admin')
  if (session instanceof Response) return session
  try {
    const { jobId } = await params
    const body = Body.parse(await req.json())
    const result = await withServiceRole(async (tx) => {
      const blocked = await finishBlock(tx, jobId, session.roles.includes('admin'))
      if (blocked) return blocked
      const moved = await tx
        .update(jobs)
        .set({
          status: 'submitted',
          deliveredAt: sql`now()`,
          // The completion record shares the cleaning artifact's column and shape.
          cleaningChecklist: {
            checkedTasks: [],
            notes: body.notes,
            photos: body.areaPhotos.flatMap((f) => f.paths),
            areaPhotos: body.areaPhotos,
            completedAt: new Date().toISOString(),
          },
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(jobs.id, jobId),
            eq(jobs.inspectionType, 'repairs'),
            // Started on site (checked in), then checked out before this.
            eq(jobs.status, 'in_progress'),
            session.roles.includes('admin') ? sql`true` : eq(jobs.clerkId, session.userId)
          )
        )
        .returning({ id: jobs.id })
      if (!moved.length) return false
      await logAuditEvent(tx, {
        category: 'job_lifecycle',
        action: 'job.submitted',
        actorUserId: session.userId,
        targetType: 'job',
        targetId: jobId,
        payload: { service: 'repairs' },
        ipAddress: callerIp(req),
        userAgent: callerUserAgent(req),
      })
      return true
    })
    if (typeof result === 'string') return Response.json({ error: result }, { status: 409 })
    if (!result) return Response.json({ error: 'This isn’t one of your active repairs.' }, { status: 409 })
    return ok({ success: true })
  } catch (err) {
    console.error('[clerk/complete-repair] error:', err)
    return errorResponse(err)
  }
}
