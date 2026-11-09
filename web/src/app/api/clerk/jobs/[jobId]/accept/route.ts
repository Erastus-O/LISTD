import { getPricing } from '@/lib/listd/pricing-settings'
import { proJobBlock, proVerificationBlock, setFeeForAcceptingPro } from '@/lib/listd/pro-levels'
import { and, eq, isNull, ne, sql } from 'drizzle-orm'
import { z } from 'zod'
import { errorResponse, ok, conflict, notFound } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import {
  jobs,
  notifications,
  organisationMembers,
  profiles,
  properties,
  withServiceRole,
} from '@/db'
import { callerIp, callerUserAgent, logAuditEvent } from '@/lib/audit'
import { isStripeConfigured } from '@/lib/billing/stripe'
import { notifyUserSms } from '@/lib/notify-prefs'
import { sendPushToUser } from '@/lib/push'
import { emailPrimaryTenantSlotRequest } from '@/lib/tenant-slot-request'
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
      const arrivalPhrase = scheduledAtIso
        ? ` Arrival confirmed for ${body.arrivalTime}.`
        : ''

      // Resolve the property address for the notification body — single
      // extra SELECT, scoped to the property we just claimed.
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

      // Notification fan-out:
      //   - The job's client_id (worker or solo client) gets notified.
      //   - If the job belongs to an org, every active owner also gets a
      //     copy so they see the pipeline regardless of who posted it.
      //   - The clerk gets their own activity-feed entry.
      // Deduped by userId so a client who's also an org owner only sees
      // one notification.
      const recipients = new Map<string, { title: string; message: string; link: string }>()
      recipients.set(job.clientId, {
        title: 'Pro assigned',
        message: `Your job ${refSlug} at ${addr} has been accepted by a verified Pro.${arrivalPhrase}`,
        link: `/client/jobs/${jobId}`,
      })
      if (job.organisationId) {
        const owners = await tx
          .select({ userId: organisationMembers.userId })
          .from(organisationMembers)
          .where(
            and(
              eq(organisationMembers.organisationId, job.organisationId),
              eq(organisationMembers.orgRole, 'owner'),
              eq(organisationMembers.status, 'active'),
              ne(organisationMembers.userId, job.clientId)
            )
          )
        for (const o of owners) {
          recipients.set(o.userId, {
            title: 'Org job accepted',
            message: `Job ${refSlug} at ${addr} (posted by a team member) has been accepted by a clerk.`,
            link: `/client/jobs/${jobId}`,
          })
        }
      }
      recipients.set(session.userId, {
        title: 'Job accepted',
        message: `You've been assigned to ${refSlug} at ${addr}. Full details now available.`,
        link: `/clerk/jobs/${jobId}`,
      })
      await tx.insert(notifications).values(
        Array.from(recipients.entries()).map(([userId, n]) => ({
          userId,
          type: 'job',
          title: n.title,
          message: n.message,
          link: n.link,
        }))
      )

      // SMS targets: the client + any org owners (NOT the clerk, who just
      // performed the accept and already knows). Fired after commit.
      const smsTargets = Array.from(recipients.keys()).filter(
        (id) => id !== session.userId
      )
      return { status: 'ok' as const, jobId, smsTargets, addr, refSlug, arrivalPhrase }
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

    // Job-update SMS (gated by each recipient's `smsJobUpdates` pref +
    // phone on file). Best-effort; never blocks or fails the accept.
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://listd.pro'
    const smsBody = `LISTD: Your inspection ${result.refSlug} at ${result.addr} has been accepted by a clerk.${result.arrivalPhrase} ${siteUrl}/client/jobs/${result.jobId}`
    await Promise.allSettled(
      result.smsTargets.map((userId) =>
        notifyUserSms(userId, 'smsJobUpdates', smsBody)
      )
    )

    // Desktop/web push to the client (+ org owners) and the clerk. Best-effort;
    // sendPushToUser never throws and no-ops when VAPID isn't configured.
    await Promise.allSettled([
      ...result.smsTargets.map((userId) =>
        sendPushToUser(userId, {
          title: 'Pro assigned',
          body: `${result.refSlug} at ${result.addr} has been accepted.`,
          url: `/client/jobs/${result.jobId}`,
          tag: `job:${result.jobId}:accepted`,
        })
      ),
      sendPushToUser(session.userId, {
        title: 'Job accepted',
        body: `You're assigned to ${result.refSlug} at ${result.addr}.`,
        url: `/clerk/jobs/${result.jobId}`,
        tag: `job:${result.jobId}:accepted`,
      }),
    ])

    // Email the primary tenant their slot-picker link (best-effort; no-ops if
    // there's no specific timeframe or no tenant email).
    await emailPrimaryTenantSlotRequest({
      jobId: result.jobId,
      issuedBy: session.userId,
    }).catch((e) =>
      console.warn('[clerk/jobs/accept] tenant slot email failed:', e)
    )

    return ok({ success: true, jobId: result.jobId })
  } catch (err) {
    console.error('[clerk/jobs/accept] error:', err)
    return errorResponse(err)
  }
}
