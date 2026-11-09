import { and, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { conflict, errorResponse, notFound, ok } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import { jobs, notifications, withServiceRole } from '@/db'
import { callerIp, callerUserAgent, logAuditEvent } from '@/lib/audit'
import { releaseToClient } from '@/lib/listd/lifecycle'
import { getPricing } from '@/lib/listd/pricing-settings'
import { issueEscrowReceiptForJob } from '@/lib/billing/escrow-receipt'
import { isCleaningType } from '@/lib/pricing-matrix'

export const maxDuration = 30
export const runtime = 'nodejs'

type Params = Promise<{ jobId: string }>

const RequestSchema = z
  .object({
    decision: z.enum(['approve', 'return']),
    notes: z.string().trim().max(2000).optional(),
  })
  .strict()
  .refine((b) => b.decision === 'approve' || (b.notes && b.notes.length > 0), {
    message: 'Notes are required when returning a clean',
    path: ['notes'],
  })

/**
 * POST /api/admin/cleaning/[jobId]/decision — admin sign-off on a completed
 * clean (the cleaning counterpart of the inspection quality-review decision).
 *
 *   - **approve** → job `reviewed` (the client approves next, then payout) +
 *     issue the client's paid-invoice receipt (best-effort, post-commit).
 *   - **return**  → job back to `in_progress` so the cleaner can re-do; the
 *     reviewer's notes are sent to the cleaner.
 *
 * Only applies to `clean_*` jobs currently in `submitted` (awaiting sign-off).
 */
export async function POST(req: Request, { params }: { params: Params }) {
  const session = await authorizeRequest('admin')
  if (session instanceof Response) return session

  try {
    const { jobId } = await params
    const body = RequestSchema.parse(await req.json())
    const pricing = await getPricing()
    const ip = callerIp(req)
    const ua = callerUserAgent(req)

    const result = await withServiceRole(async (tx) => {
      const [job] = await tx
        .select({
          id: jobs.id,
          status: jobs.status,
          inspectionType: jobs.inspectionType,
          clientId: jobs.clientId,
          cleanerId: jobs.cleanerId,
        })
        .from(jobs)
        .where(eq(jobs.id, jobId))
        .limit(1)
      if (!job) return { state: 'not_found' as const }
      if (!isCleaningType(job.inspectionType) && job.inspectionType !== 'repairs') {
        return { state: 'not_clean' as const }
      }
      if (job.status !== 'submitted') {
        return { state: 'bad_status' as const, current: job.status }
      }

      const refSlug = jobId.slice(0, 8)

      if (body.decision === 'approve') {
        // LISTD's review passed: the client now has the review window. Payment
        // is only payable once they approve.
        const released = await releaseToClient(tx, {
          jobId,
          actorId: session.userId,
          reviewHours: pricing.reviewHours,
          via: 'cleaning_review',
          notes: body.notes ?? null,
        })
        if (!released.ok) return { state: 'bad_status' as const }
        if (job.cleanerId) {
          await tx.insert(notifications).values({
            userId: job.cleanerId,
            type: 'job',
            title: 'Clean passed LISTD review',
            message: `Clean ${refSlug} has gone to the client to approve.`,
            link: `/cleaner/earnings`,
          })
        }
        return { state: 'approved' as const }
      }

      // return → back to the cleaner for amends.
      await tx
        .update(jobs)
        .set({ status: 'in_progress', updatedAt: sql`now()` })
        .where(and(eq(jobs.id, jobId), eq(jobs.status, 'submitted')))

      await logAuditEvent(tx, {
        category: 'job_lifecycle',
        action: 'job.in_progress',
        actorUserId: session.userId,
        targetType: 'job',
        targetId: jobId,
        payload: {
          service: 'cleaning',
          reason: 'returned_for_amends',
          notes: body.notes,
        },
        ipAddress: ip,
        userAgent: ua,
      })

      if (job.cleanerId) {
        await tx.insert(notifications).values({
          userId: job.cleanerId,
          type: 'job',
          title: 'Clean returned for amends',
          message: `Your clean ${refSlug} needs changes: ${body.notes}`,
          link: `/cleaner/jobs/${jobId}`,
        })
      }
      return { state: 'returned' as const }
    })

    if (result.state === 'not_found') return notFound('Job not found')
    if (result.state === 'not_clean') {
      return Response.json({ error: 'Not a cleaning job' }, { status: 400 })
    }
    if (result.state === 'bad_status') {
      return conflict('This clean is not awaiting sign-off.')
    }

    // On approve, issue the client receipt.
    // Best-effort, post-commit, no-throw — never undoes the approval.
    if (result.state === 'approved') {
      const receipt = await issueEscrowReceiptForJob(
        jobId,
        session.userId
      ).catch(() => ({ issued: false, reason: 'error' as const }))
      if (
        !receipt.issued &&
        receipt.reason !== 'already_invoiced' &&
        receipt.reason !== 'no_settled_escrow'
      ) {
        console.warn(
          `[admin/cleaning/decision] receipt not issued for job ${jobId}:`,
          receipt.reason
        )
      }
    }

    return ok({ success: true, decision: result.state })
  } catch (err) {
    console.error('[admin/cleaning/decision] error:', err)
    return errorResponse(err)
  }
}
