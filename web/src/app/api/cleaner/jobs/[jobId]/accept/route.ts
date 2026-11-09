import { getPricing } from '@/lib/listd/pricing-settings'
import { proJobBlock, proVerificationBlock, setFeeForAcceptingPro } from '@/lib/listd/pro-levels'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'
import { conflict, errorResponse, notFound, ok } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import {
  jobs,
  notifications,
  profiles,
  properties,
  withServiceRole,
} from '@/db'
import { callerIp, callerUserAgent, logAuditEvent } from '@/lib/audit'
import { isStripeConfigured } from '@/lib/billing/stripe'
import { ukWallTimeToUtcIso } from '@/lib/scheduling/exact-time'

export const maxDuration = 15
export const runtime = 'nodejs'

type Params = Promise<{ jobId: string }>

// Committed arrival time (UK wall clock) — optional so callers without a
// body keep working; the accept dialog always sends one.
const RequestSchema = z
  .object({
    arrivalTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .optional(),
  })
  .strict()

/**
 * POST /api/cleaner/jobs/[jobId]/accept — cleaner claims a published cleaning
 * job. Optimistic claim guard in the WHERE (status published + cleaner_id null
 * + a clean_* type) means a concurrent claim matches zero rows → 409.
 */
export async function POST(req: Request, { params }: { params: Params }) {
  const session = await authorizeRequest('cleaner', 'admin')
  if (session instanceof Response) return session

  try {
    const { jobId } = await params
    const body = RequestSchema.parse(await req.json().catch(() => ({})))
    const ip = callerIp(req)
    const ua = callerUserAgent(req)

    // Payout gate: a cleaner must finish Stripe Connect payout onboarding
    // before claiming work, so an approved clean has somewhere to pay them.
    // Only enforced when escrow is configured; admins are exempt. The client
    // turns `payouts_not_setup` into a toast + redirect to settings.
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
          cleanerId: session.userId,
          status: 'accepted',
          acceptedAt: sql`now()`,
        })
        .where(
          and(
            eq(jobs.id, jobId),
            eq(jobs.status, 'published'),
            isNull(jobs.cleanerId),
            sql`${jobs.inspectionType} LIKE 'clean\\_%'`
          )
        )
        .returning({
          id: jobs.id,
          clientId: jobs.clientId,
          inspectionType: jobs.inspectionType,
          propertyId: jobs.propertyId,
          scheduledDate: jobs.scheduledDate,
        })

      if (claimed.length === 0) {
        const [exists] = await tx
          .select({ id: jobs.id })
          .from(jobs)
          .where(eq(jobs.id, jobId))
          .limit(1)
        return exists
          ? { status: 'conflict' as const }
          : { status: 'not_found' as const }
      }
      const job = claimed[0]

      // The fee depends on this Pro's level in the job's role.
      await setFeeForAcceptingPro(tx, pricing, job.id, session.userId)

      // Committed arrival time → jobs.scheduled_at (UK wall clock → UTC).
      // Arms the 2-hour reminder and the missed check-in alarm (§12).
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
      const arrivalPhrase = scheduledAtIso
        ? ` Arrival confirmed for ${body.arrivalTime}.`
        : ''

      const [prop] = job.propertyId
        ? await tx
            .select({
              addressLine1: properties.addressLine1,
              postcode: properties.postcode,
            })
            .from(properties)
            .where(eq(properties.id, job.propertyId))
            .limit(1)
        : [null]
      const addr = prop?.addressLine1
        ? `${prop.addressLine1}${prop.postcode ? ', ' + prop.postcode : ''}`
        : 'a property'
      const refSlug = jobId.slice(0, 8)

      await logAuditEvent(tx, {
        category: 'job_lifecycle',
        action: 'job.accepted',
        actorUserId: session.userId,
        targetType: 'job',
        targetId: jobId,
        payload: {
          cleanerId: session.userId,
          service: 'cleaning',
          ...(scheduledAtIso
            ? { arrivalTime: body.arrivalTime, scheduledAt: scheduledAtIso }
            : {}),
        },
        ipAddress: ip,
        userAgent: ua,
      })

      await tx.insert(notifications).values([
        {
          userId: job.clientId,
          type: 'job',
          title: 'Cleaner assigned',
          message: `Your clean ${refSlug} at ${addr} has been accepted by a verified cleaner.${arrivalPhrase}`,
          link: `/client/jobs/${jobId}`,
        },
        {
          userId: session.userId,
          type: 'job',
          title: 'Clean accepted',
          message: `You've been assigned to ${refSlug} at ${addr}.`,
          link: `/cleaner/jobs/${jobId}`,
        },
      ])

      return { status: 'ok' as const, jobId }
    })

    if (result.status === 'not_verified') {
      return Response.json({ error: result.message, code: 'not_verified' }, { status: 403 })
    }
    if (result.status === 'level_blocked') {

      return Response.json({ error: result.message, code: 'level_required' }, { status: 403 })

    }

    if (result.status === 'not_found') return notFound('Job not found')
    if (result.status === 'conflict') {
      return conflict('Job already claimed by another cleaner')
    }
    return ok({ success: true, jobId: result.jobId })
  } catch (err) {
    console.error('[cleaner/jobs/accept] error:', err)
    return errorResponse(err)
  }
}
