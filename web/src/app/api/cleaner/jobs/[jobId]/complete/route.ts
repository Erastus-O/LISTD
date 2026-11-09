import { and, eq, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import { conflict, errorResponse, ok } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import { jobs, notifications, withServiceRole } from '@/db'
import { callerIp, callerUserAgent, logAuditEvent } from '@/lib/audit'
import { isCleaningType } from '@/lib/pricing-matrix'
import { getCleaningChecklistForType } from '@/lib/cleaning/checklists'
import { getEffectivePricing } from '@/lib/pricing-settings'

export const maxDuration = 20
export const runtime = 'nodejs'

type Params = Promise<{ jobId: string }>

const RequestSchema = z.object({
  checkedTasks: z.array(z.number().int().min(0).max(100)).max(100),
  notes: z.string().max(2000).optional(),
  photos: z.array(z.string().min(1).max(500)).max(40).optional(),
})

/**
 * POST /api/cleaner/jobs/[jobId]/complete — finish a cleaning job. Stores the
 * checklist submission (ticked tasks + notes + photo paths) on
 * `jobs.cleaning_checklist` and moves the job to `completed`. Requires the job
 * to be the cleaner's own and in `accepted`/`in_progress`.
 *
 * Every task must be ticked to complete — the checklist is the standard of
 * work. Requires migrations 0024 + 0025.
 */
export async function POST(req: Request, { params }: { params: Params }) {
  const session = await authorizeRequest('cleaner', 'admin')
  if (session instanceof Response) return session

  try {
    const { jobId } = await params
    const body = RequestSchema.parse(await req.json())

    const result = await withServiceRole(async (tx) => {
      const [job] = await tx
        .select({
          id: jobs.id,
          cleanerId: jobs.cleanerId,
          status: jobs.status,
          inspectionType: jobs.inspectionType,
          clientId: jobs.clientId,
        })
        .from(jobs)
        .where(eq(jobs.id, jobId))
        .limit(1)
      if (!job) return { state: 'not_found' as const }
      if (job.cleanerId !== session.userId && !session.roles.includes('admin')) {
        return { state: 'forbidden' as const }
      }
      if (!isCleaningType(job.inspectionType)) {
        return { state: 'not_clean' as const }
      }
      if (job.status !== 'accepted' && job.status !== 'in_progress') {
        return { state: 'bad_status' as const }
      }

      // All checklist tasks must be ticked. Type-aware: built-in levels use
      // the code checklists; admin-defined offerings carry theirs in the
      // rate card. No checklist on file (e.g. a custom clean with an empty
      // task list) → nothing to enforce.
      const checklist = getCleaningChecklistForType(
        job.inspectionType,
        (await getEffectivePricing()).cleaning
      )
      const taskCount = checklist?.tasks.length ?? 0
      const checked = new Set(body.checkedTasks.filter((i) => i < taskCount))
      if (checked.size < taskCount) {
        return { state: 'incomplete' as const, taskCount, checked: checked.size }
      }

      const completedAt = new Date().toISOString()
      const claimed = await tx
        .update(jobs)
        .set({
          // Cleaner finishing the work submits it for admin sign-off — the
          // payout is released only once an admin approves (mirrors the
          // inspection QA flow). `deliveredAt` marks the work as done.
          status: 'submitted',
          deliveredAt: sql`now()`,
          cleaningChecklist: {
            checkedTasks: Array.from(checked).sort((a, b) => a - b),
            notes: body.notes ?? '',
            photos: body.photos ?? [],
            completedAt,
          },
        })
        .where(
          and(
            eq(jobs.id, jobId),
            inArray(jobs.status, ['accepted', 'in_progress'])
          )
        )
        .returning({ id: jobs.id })
      if (claimed.length === 0) return { state: 'bad_status' as const }

      await logAuditEvent(tx, {
        category: 'job_lifecycle',
        action: 'job.submitted',
        actorUserId: session.userId,
        targetType: 'job',
        targetId: jobId,
        payload: {
          service: 'cleaning',
          inspectionType: job.inspectionType,
          photos: (body.photos ?? []).length,
        },
        ipAddress: callerIp(req),
        userAgent: callerUserAgent(req),
      })

      await tx.insert(notifications).values({
        userId: job.clientId,
        type: 'job',
        title: 'Clean submitted for review',
        message: `Your clean ${jobId.slice(0, 8)} has been completed and is under review.`,
        link: `/client/jobs/${jobId}`,
      })

      return { state: 'ok' as const }
    })

    if (result.state === 'not_found') {
      return Response.json({ error: 'Job not found' }, { status: 404 })
    }
    if (result.state === 'forbidden') {
      return Response.json({ error: 'Not your job' }, { status: 403 })
    }
    if (result.state === 'not_clean') {
      return Response.json({ error: 'Not a cleaning job' }, { status: 400 })
    }
    if (result.state === 'incomplete') {
      return Response.json(
        {
          error: `Tick every task before completing (${result.checked}/${result.taskCount}).`,
        },
        { status: 400 }
      )
    }
    if (result.state === 'bad_status') {
      return conflict('Job is not in a completable state.')
    }

    // No payout here — the clean is now `submitted` for admin sign-off. The
    // escrow release + client receipt fire when an admin approves it.
    return ok({ success: true })
  } catch (err) {
    console.error('[cleaner/jobs/complete] error:', err)
    return errorResponse(err)
  }
}
