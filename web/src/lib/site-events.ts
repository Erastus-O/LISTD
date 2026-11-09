import 'server-only'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { conflict, errorResponse, forbidden, notFound, ok } from '@/lib/api'
import {
  jobSiteEvents,
  jobs,
  notifications,
  userRoles,
  withServiceRole,
} from '@/db'
import { callerIp, callerUserAgent, logAuditEvent } from '@/lib/audit'
import { notifyUserSms } from '@/lib/notify-prefs'

/**
 * Shared handler for the on-site event routes (framework §14 items 1/3/4):
 *
 *   arrival      — check-in: server timestamp + optional geolocation +
 *                  optional doorstep photo. Once per job per actor.
 *   running_late — honest ETA flag; client is notified immediately
 *                  (in-app + SMS). Halves lateness penalties (§5.A2).
 *   no_access    — structured aborted-visit report: reason category, wait
 *                  window, contact attempts, photos. The B1 evidence
 *                  bundle; admins are alerted to run the aborted-visit
 *                  flow manually until it is automated.
 *
 * One handler serves both /api/clerk and /api/cleaner routes — the only
 * differences are which assignment column must match the caller and the
 * `service` tag on the audit row.
 */

const NO_ACCESS_REASONS = [
  'no_keys',
  'keyholder_absent',
  'wrong_address',
  'wrong_access_code',
  'property_unsafe',
  'tenant_refused',
  'other',
] as const

const isoDate = z
  .string()
  .max(40)
  .refine((v) => !Number.isNaN(Date.parse(v)), 'Invalid timestamp')

const geoFields = {
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  accuracyM: z.number().nonnegative().max(100_000).optional(),
}

const SiteEventSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('arrival'),
      note: z.string().trim().max(2000).optional(),
      photoPaths: z.array(z.string().min(1).max(500)).max(5).optional(),
      ...geoFields,
    })
    .strict(),
  z
    .object({
      kind: z.literal('running_late'),
      etaMinutes: z.number().int().min(5).max(480),
      note: z.string().trim().max(2000).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('no_access'),
      reason: z.enum(NO_ACCESS_REASONS),
      note: z.string().trim().max(2000).optional(),
      waitFrom: isoDate.optional(),
      waitUntil: isoDate.optional(),
      contactAttempts: z
        .array(
          z
            .object({
              at: isoDate,
              method: z.enum(['call', 'sms', 'message']),
            })
            .strict()
        )
        .max(20)
        .optional(),
      photoPaths: z.array(z.string().min(1).max(500)).max(10).optional(),
      ...geoFields,
    })
    .strict(),
])

export type SiteEventInput = z.infer<typeof SiteEventSchema>

// A pro can be on site from acceptance until the job closes. `running_late`
// only makes sense before they've started working.
const ON_SITE_STATUSES = ['accepted', 'assigned', 'in_progress'] as const
const LATE_STATUSES = ['accepted', 'assigned'] as const

export async function handleSiteEvent(opts: {
  req: Request
  jobId: string
  userId: string
  role: 'clerk' | 'cleaner'
}): Promise<Response> {
  const { req, jobId, userId, role } = opts
  try {
    const body = SiteEventSchema.parse(await req.json())
    const ip = callerIp(req)
    const ua = callerUserAgent(req)

    const result = await withServiceRole(async (tx) => {
      const [job] = await tx
        .select({
          id: jobs.id,
          status: jobs.status,
          clientId: jobs.clientId,
          clerkId: jobs.clerkId,
          cleanerId: jobs.cleanerId,
        })
        .from(jobs)
        .where(eq(jobs.id, jobId))
        .limit(1)
      if (!job) return { status: 'not_found' as const }

      const assignedId = role === 'clerk' ? job.clerkId : job.cleanerId
      if (assignedId !== userId) return { status: 'forbidden' as const }

      const allowed: readonly string[] =
        body.kind === 'running_late' ? LATE_STATUSES : ON_SITE_STATUSES
      if (!allowed.includes(job.status)) {
        return { status: 'wrong_state' as const, current: job.status }
      }

      if (body.kind === 'arrival') {
        const [existing] = await tx
          .select({ id: jobSiteEvents.id })
          .from(jobSiteEvents)
          .where(
            and(
              eq(jobSiteEvents.jobId, jobId),
              eq(jobSiteEvents.actorUserId, userId),
              eq(jobSiteEvents.kind, 'arrival')
            )
          )
          .limit(1)
        if (existing) return { status: 'already' as const }
      }

      const [event] = await tx
        .insert(jobSiteEvents)
        .values({
          jobId,
          actorUserId: userId,
          actorRole: role,
          kind: body.kind,
          note: body.note ?? null,
          etaMinutes: body.kind === 'running_late' ? body.etaMinutes : null,
          reason: body.kind === 'no_access' ? body.reason : null,
          waitFrom:
            body.kind === 'no_access' && body.waitFrom
              ? new Date(body.waitFrom).toISOString()
              : null,
          waitUntil:
            body.kind === 'no_access' && body.waitUntil
              ? new Date(body.waitUntil).toISOString()
              : null,
          contactAttempts:
            body.kind === 'no_access' ? (body.contactAttempts ?? []) : [],
          latitude: body.kind !== 'running_late' ? (body.latitude ?? null) : null,
          longitude:
            body.kind !== 'running_late' ? (body.longitude ?? null) : null,
          accuracyM:
            body.kind !== 'running_late' ? (body.accuracyM ?? null) : null,
          photoPaths:
            body.kind !== 'running_late' ? (body.photoPaths ?? []) : [],
        })
        .returning({ id: jobSiteEvents.id, createdAt: jobSiteEvents.createdAt })

      const auditAction =
        body.kind === 'arrival'
          ? 'job.checked_in'
          : body.kind === 'running_late'
            ? 'job.running_late'
            : 'job.no_access_reported'
      await logAuditEvent(tx, {
        category: 'job_lifecycle',
        action: auditAction,
        actorUserId: userId,
        targetType: 'job',
        targetId: jobId,
        payload: {
          service: role === 'clerk' ? 'inspection' : 'cleaning',
          siteEventId: event.id,
          ...(body.kind === 'running_late'
            ? { etaMinutes: body.etaMinutes }
            : {}),
          ...(body.kind === 'no_access' ? { reason: body.reason } : {}),
          ...(body.kind !== 'running_late'
            ? { hasGeo: body.latitude != null && body.longitude != null }
            : {}),
        },
        ipAddress: ip,
        userAgent: ua,
      })

      const refSlug = jobId.slice(0, 8)
      const proNoun = role === 'clerk' ? 'pro' : 'cleaner'
      if (job.clientId) {
        const clientNotice =
          body.kind === 'arrival'
            ? {
                title: `Your ${proNoun} has arrived`,
                message: `Your ${proNoun} checked in at the property for job ${refSlug}.`,
              }
            : body.kind === 'running_late'
              ? {
                  title: `Your ${proNoun} is running late`,
                  message: `Your ${proNoun} expects to arrive in about ${body.etaMinutes} minutes for job ${refSlug}.`,
                }
              : {
                  title: 'Access problem reported',
                  message: `Your ${proNoun} could not access the property for job ${refSlug}. Our team is reviewing — please check your access arrangements.`,
                }
        await tx.insert(notifications).values({
          userId: job.clientId,
          type: 'job',
          title: clientNotice.title,
          message: clientNotice.message,
          link: `/client/jobs/${jobId}`,
        })
      }

      if (body.kind === 'no_access') {
        const admins = await tx
          .select({ userId: userRoles.userId })
          .from(userRoles)
          .where(eq(userRoles.role, 'admin'))
        if (admins.length > 0) {
          await tx.insert(notifications).values(
            admins.map((a) => ({
              userId: a.userId,
              type: 'system',
              title: 'No-access report filed',
              message: `Job ${refSlug}: ${role} reported no access (${body.reason.replaceAll('_', ' ')}). Review the evidence and run the aborted-visit flow.`,
              link: `/admin/jobs/${jobId}`,
            }))
          )
        }
      }

      return {
        status: 'ok' as const,
        eventId: event.id,
        clientId: job.clientId,
        refSlug,
      }
    })

    if (result.status === 'not_found') return notFound('Job not found')
    if (result.status === 'forbidden') {
      return forbidden('You are not assigned to this job.')
    }
    if (result.status === 'wrong_state') {
      return conflict(`Cannot record this from status ${result.current}.`)
    }
    if (result.status === 'already') {
      return conflict('Already checked in for this job.')
    }

    // SMS after commit — a slow Twilio call must never hold a DB connection.
    if (result.clientId && body.kind !== 'arrival') {
      const smsBody =
        body.kind === 'running_late'
          ? `LISTD: your pro is running ~${body.etaMinutes} min late for job ${result.refSlug}. Sorry for the delay.`
          : `LISTD: your pro reported an access problem at job ${result.refSlug}. Please check your access arrangements — our team is on it.`
      await notifyUserSms(result.clientId, 'smsJobUpdates', smsBody.slice(0, 300))
    }

    return ok({ success: true, eventId: result.eventId })
  } catch (err) {
    console.error('[site-events] error:', err)
    return errorResponse(err)
  }
}
