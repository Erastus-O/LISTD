import { eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import {
  badRequest,
  errorResponse,
  noContent,
  notFound,
  ok,
} from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import { jobs, notifications, withServiceRole } from '@/db'
import { callerIp, callerUserAgent, logAuditEvent } from '@/lib/audit'
import { formatUkTime, ukWallTimeToUtcIso } from '@/lib/scheduling/exact-time'

export const runtime = 'nodejs'

type Params = Promise<{ jobId: string }>

/**
 * POST /api/admin/jobs/[jobId]/schedule — admin sets or corrects the
 * appointment: the date and/or the exact arrival time (UK wall clock).
 * The exact time becomes `jobs.scheduled_at`, arming the 2-hour reminder
 * and the missed check-in alarm (framework §12); `time: null` clears it.
 *
 * Mirrors the pricing-override shape: strict zod, no-op short-circuit,
 * one UPDATE + audit row in the same tx, in-app notifications to the
 * assigned pro and the client.
 */
const RequestSchema = z
  .object({
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    time: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .nullable()
      .optional(),
  })
  .strict()
  .refine((b) => b.date !== undefined || b.time !== undefined, {
    message: 'Provide a date and/or a time.',
  })

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
          scheduledDate: jobs.scheduledDate,
          scheduledAt: jobs.scheduledAt,
          clerkId: jobs.clerkId,
          cleanerId: jobs.cleanerId,
          clientId: jobs.clientId,
        })
        .from(jobs)
        .where(eq(jobs.id, jobId))
        .limit(1)
      if (!job) return { status: 'not_found' as const }

      const newDate = body.date ?? job.scheduledDate

      // Resolve the new exact time:
      //   time: "HH:MM"  → set on newDate
      //   time: null     → clear
      //   time omitted   → keep the existing UK wall-clock time, re-anchored
      //                    to the new date (a date-only correction shouldn't
      //                    silently drop the confirmed arrival time).
      let newScheduledAt: string | null
      if (body.time === null) {
        newScheduledAt = null
      } else if (typeof body.time === 'string') {
        newScheduledAt = ukWallTimeToUtcIso(newDate, body.time)
        if (!newScheduledAt) return { status: 'bad_time' as const }
      } else if (job.scheduledAt) {
        newScheduledAt = ukWallTimeToUtcIso(newDate, formatUkTime(job.scheduledAt))
      } else {
        newScheduledAt = null
      }

      const dateChanged = newDate !== job.scheduledDate
      const timeChanged = newScheduledAt !== job.scheduledAt
      if (!dateChanged && !timeChanged) return { status: 'noop' as const }

      await tx
        .update(jobs)
        .set({
          scheduledDate: newDate,
          scheduledAt: newScheduledAt,
          updatedAt: sql`now()`,
        })
        .where(eq(jobs.id, jobId))

      await logAuditEvent(tx, {
        category: 'job_lifecycle',
        action: 'job.schedule_set',
        actorUserId: session.userId,
        targetType: 'job',
        targetId: jobId,
        payload: {
          priorDate: job.scheduledDate,
          newDate,
          priorScheduledAt: job.scheduledAt,
          newScheduledAt,
          via: 'admin',
        },
        ipAddress: ip,
        userAgent: ua,
      })

      // Tell the people who plan around this time.
      const refSlug = jobId.slice(0, 8)
      const when = newScheduledAt
        ? `${newDate} at ${formatUkTime(newScheduledAt)}`
        : newDate
      const proId = job.clerkId ?? job.cleanerId
      const rows: (typeof notifications.$inferInsert)[] = []
      if (proId) {
        rows.push({
          userId: proId,
          type: 'job',
          title: 'Appointment updated',
          message: `Job ${refSlug} is now scheduled for ${when}.`,
          link: job.clerkId ? `/clerk/jobs/${jobId}` : `/cleaner/jobs/${jobId}`,
        })
      }
      if (job.clientId) {
        rows.push({
          userId: job.clientId,
          type: 'job',
          title: 'Appointment updated',
          message: `Your job ${refSlug} is now scheduled for ${when}.`,
          link: `/client/jobs/${jobId}`,
        })
      }
      if (rows.length > 0) await tx.insert(notifications).values(rows)

      return { status: 'ok' as const }
    })

    if (result.status === 'not_found') return notFound('Job not found')
    if (result.status === 'bad_time') {
      return badRequest('Could not resolve that date/time.')
    }
    if (result.status === 'noop') return noContent()
    return ok({ success: true })
  } catch (err) {
    console.error('[admin/jobs/schedule] error:', err)
    return errorResponse(err)
  }
}
