import { getPricing } from '@/lib/listd/pricing-settings'
import { proJobBlock, proVerificationBlock, setFeeForAcceptingPro } from '@/lib/listd/pro-levels'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'
import { errorResponse, ok, conflict, notFound } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import {
  jobs,
  profiles,
  properties,
  withServiceRole,
} from '@/db'
import { callerIp, callerUserAgent, logAuditEvent } from '@/lib/audit'
import { isStripeConfigured } from '@/lib/billing/stripe'
import { afterProAccept, runApprovalEffects } from '@/lib/listd/job-approval'
import { ukWallTimeToUtcIso } from '@/lib/scheduling/exact-time'

export const maxDuration = 15
export const runtime = 'nodejs'

type Params = Promise<{ jobId: string }>

// Committed arrival time (UK wall clock) — optional so older clients that
// POST without a body keep working; the modal always sends one.
const RequestSchema = z
  .object({
    arrivalTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .optional(),
  })
  .strict()

/**
 * POST /api/clerk/jobs/[jobId]/accept — clerk claims a published job
 * (Lovable port of the Available Jobs accept flow).
 *
 * Atomic in one tx with the optimistic-claim guard built into the WHERE:
 *
 *   - UPDATE jobs SET clerk_id, status='accepted', accepted_at = now()
 *     WHERE id = jobId AND status = 'published' AND clerk_id IS NULL
 *
 *     The double WHERE means a concurrent claim by another clerk causes
 *     this UPDATE to match zero rows; we surface that as 409 Conflict.
 *
 *   - Writes `job_lifecycle/job.accepted` audit row — closes the long-open
 *     `job.accepted` lifecycle audit site.
 *   - Notifies the client that their job has been picked up.
 *   - Notifies the clerk for their own activity feed.
 */
export async function POST(req: Request, { params }: { params: Params }) {
  const session = await authorizeRequest('clerk', 'trades', 'admin')
  if (session instanceof Response) return session

  try {
    const { jobId } = await params
    const body = RequestSchema.parse(await req.json().catch(() => ({})))
    const ip = callerIp(req)
    const ua = callerUserAgent(req)

    // Payout gate: a clerk must have completed Stripe Connect payout
    // onboarding before they can accept a job — otherwise an approved report
    // would have nowhere to pay them. Only enforced when escrow is configured,
    // and skipped for admins (who may assign on a clerk's behalf). The client
    // turns the `payouts_not_setup` code into a toast + redirect to settings.
    if (isStripeConfigured() && !session.roles.includes('admin')) {
      const [me] = await withServiceRole((tx) =>
        tx
          .select({ payoutsEnabled: profiles.stripePayoutsEnabled })
          .from(profiles)
          .where(eq(profiles.userId, session.userId))
          .limit(1)
      )
      if (!me?.payoutsEnabled) {
        return Response.json(
          {
            error: 'Set up payouts before accepting jobs.',
            code: 'payouts_not_setup',
          },
          { status: 403 }
        )
      }
    }

    const pricing = await getPricing()
    const result = await withServiceRole(async (tx) => {
      // Role and level are checked again here, not just in the feed.
      if (!session.roles.includes('admin')) {
        const unverified = await proVerificationBlock(tx, session.userId)
        if (unverified) return { status: 'not_verified' as const, message: unverified }
        const [target] = await tx
          .select({
            inspectionType: jobs.inspectionType,
            requiredLevel: jobs.requiredLevel,
            bedrooms: properties.bedrooms,
          })
          .from(jobs)
          .leftJoin(properties, eq(properties.id, jobs.propertyId))
          .where(eq(jobs.id, jobId))
          .limit(1)
        if (target) {
          const blocked = await proJobBlock(tx, session.userId, target)
          if (blocked) return { status: 'level_blocked' as const, message: blocked }
        }
      }
      const claimed = await tx
        .update(jobs)
        .set({
          clerkId: session.userId,
          status: 'accepted',
          acceptedAt: sql`now()`,
        })
        .where(
          and(
            eq(jobs.id, jobId),
            eq(jobs.status, 'published'),
            isNull(jobs.clerkId)
          )
        )
        .returning({
          id: jobs.id,
          clientId: jobs.clientId,
          createdByUserId: jobs.createdByUserId,
          organisationId: jobs.organisationId,
          inspectionType: jobs.inspectionType,
          propertyId: jobs.propertyId,
          scheduledDate: jobs.scheduledDate,
        })

      if (claimed.length === 0) {
        // Differentiate "doesn't exist" vs. "already claimed" to give the
        // toast a useful message.
        const [exists] = await tx
          .select({ id: jobs.id, status: jobs.status, clerkId: jobs.clerkId })
          .from(jobs)
          .where(eq(jobs.id, jobId))
          .limit(1)
        if (!exists) return { status: 'not_found' as const }
        return { status: 'conflict' as const }
      }
      const job = claimed[0]

      // The fee depends on this Pro's level in the job's role.
      await setFeeForAcceptingPro(tx, pricing, job.id, session.userId)

      // Committed arrival time → jobs.scheduled_at (UK wall clock → UTC).
      // This is what arms the 2-hour reminder and the missed check-in
      // alarm (framework §12) — without it those crons skip the job.
      const scheduledAtIso =
        body.arrivalTime && job.scheduledDate
          ? ukWallTimeToUtcIso(job.scheduledDate, body.arrivalTime)
          : null
      if (scheduledAtIso) {
        await tx
          .update(jobs)
          .set({ scheduledAt: scheduledAtIso })
          .where(eq(jobs.id, jobId))
      }
      await logAuditEvent(tx, {
        category: 'job_lifecycle',
        action: 'job.accepted',
        actorUserId: session.userId,
        targetType: 'job',
        targetId: jobId,
        payload: {
          clerkId: session.userId,
          inspectionType: job.inspectionType,
          via: 'clerk_self_assign',
          ...(scheduledAtIso
            ? { arrivalTime: body.arrivalTime, scheduledAt: scheduledAtIso }
            : {}),
        },
        ipAddress: ip,
        userAgent: ua,
      })

      // LISTD approves before the address, codes and contacts unlock and the
      // client hears a Pro is booked; auto-approved when the setting allows.
      const approval = await afterProAccept(tx, { jobId, proId: session.userId, inspectionType: job.inspectionType })
      return { status: 'ok' as const, jobId, approval }
    })

    if (result.status === 'not_verified') {
      return Response.json({ error: result.message, code: 'not_verified' }, { status: 403 })
    }
    if (result.status === 'level_blocked') {

      return Response.json({ error: result.message, code: 'level_required' }, { status: 403 })

    }

    if (result.status === 'not_found') return notFound('Job not found')
    if (result.status === 'conflict') {
      return conflict('Job already claimed by another clerk')
    }

    if (result.approval.effects) await runApprovalEffects(result.approval.effects, session.userId)

    return ok({ success: true, jobId: result.jobId, awaitingApproval: !result.approval.approved })
  } catch (err) {
    console.error('[clerk/jobs/accept] error:', err)
    return errorResponse(err)
  }
}
