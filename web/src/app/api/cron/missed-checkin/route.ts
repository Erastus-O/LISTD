import { and, eq, gte, inArray, isNotNull, lt } from 'drizzle-orm'
import { errorResponse, ok, unauthorized } from '@/lib/api'
import {
  appointmentRemindersSent,
  jobSiteEvents,
  jobs,
  notifications,
  properties,
  userRoles,
  withServiceRole,
} from '@/db'
import { notifyUserSms } from '@/lib/notify-prefs'
import { sendPushToUser } from '@/lib/push'
import { verifyCronAuth, verifyExternalApiKey } from '@/lib/webhooks'

export const maxDuration = 60
export const runtime = 'nodejs'

/**
 * GET /api/cron/missed-checkin
 *
 * Vercel Cron — every 10 minutes. The framework §12.3 missed check-in
 * alarm: proactive no-show detection instead of waiting for the client
 * to complain.
 *
 * Two escalation stages, each idempotent via `appointment_reminders_sent`:
 *
 *   +15 min past `scheduled_at`, no arrival check-in
 *     → kind 'missed_checkin_nudge': push + SMS to the assigned pro —
 *       "check in or flag that you're late".
 *   +30 min past `scheduled_at`, still no arrival
 *     → kind 'missed_checkin_alarm': in-app alert to every admin to run
 *       the provisional no-show flow (framework §5.A1 — admin confirms
 *       before any penalty applies; this cron never penalises anyone).
 *
 * Only `accepted`/`assigned` jobs — `in_progress` means the pro is
 * already working. Jobs without `scheduled_at` are skipped (same
 * known gap as appointment-reminders-soon: better to make booking /
 * reschedule write `scheduled_at` than to guess a time from the slot).
 * Look-back is capped at 6 h so stale never-scheduled rows don't alarm
 * forever.
 */

const NUDGE_KIND = 'missed_checkin_nudge' as const
const ALARM_KIND = 'missed_checkin_alarm' as const
const NUDGE_AFTER_MIN = 15
const ALARM_AFTER_MIN = 30
const LOOKBACK_HOURS = 6

const PENDING_ARRIVAL_STATUSES = ['accepted', 'assigned'] as const

export async function GET(req: Request) {
  if (!verifyCronAuth(req) && !verifyExternalApiKey(req)) {
    return unauthorized()
  }

  try {
    const now = Date.now()
    const nudgeCutoff = new Date(now - NUDGE_AFTER_MIN * 60 * 1000)
    const alarmCutoff = new Date(now - ALARM_AFTER_MIN * 60 * 1000)
    const lookbackStart = new Date(now - LOOKBACK_HOURS * 60 * 60 * 1000)

    const plan = await withServiceRole(async (tx) => {
      // ── 1. Candidates: live jobs whose scheduled time has passed ──────
      const candidates = await tx
        .select({
          id: jobs.id,
          clerkId: jobs.clerkId,
          cleanerId: jobs.cleanerId,
          propertyId: jobs.propertyId,
          scheduledAt: jobs.scheduledAt,
        })
        .from(jobs)
        .where(
          and(
            isNotNull(jobs.scheduledAt),
            gte(jobs.scheduledAt, lookbackStart.toISOString()),
            lt(jobs.scheduledAt, nudgeCutoff.toISOString()),
            inArray(jobs.status, [...PENDING_ARRIVAL_STATUSES])
          )
        )
      if (candidates.length === 0) {
        return { nudges: [], alarms: [], admins: [] as string[] }
      }
      const candidateIds = candidates.map((c) => c.id)

      // ── 2. Drop jobs that DO have an arrival check-in ─────────────────
      const arrivals = await tx
        .select({ jobId: jobSiteEvents.jobId })
        .from(jobSiteEvents)
        .where(
          and(
            inArray(jobSiteEvents.jobId, candidateIds),
            eq(jobSiteEvents.kind, 'arrival')
          )
        )
      const arrivedSet = new Set(arrivals.map((a) => a.jobId))
      const missing = candidates.filter((c) => !arrivedSet.has(c.id))
      if (missing.length === 0) {
        return { nudges: [], alarms: [], admins: [] as string[] }
      }
      const missingIds = missing.map((c) => c.id)

      // ── 3. De-dupe both stages against the idempotency table ──────────
      const sent = await tx
        .select({
          jobId: appointmentRemindersSent.jobId,
          kind: appointmentRemindersSent.kind,
        })
        .from(appointmentRemindersSent)
        .where(
          and(
            inArray(appointmentRemindersSent.jobId, missingIds),
            inArray(appointmentRemindersSent.kind, [NUDGE_KIND, ALARM_KIND])
          )
        )
      const sentSet = new Set(sent.map((r) => `${r.jobId}:${r.kind}`))

      const nudgeJobs = missing.filter(
        (c) => !sentSet.has(`${c.id}:${NUDGE_KIND}`)
      )
      const alarmJobs = missing.filter(
        (c) =>
          !sentSet.has(`${c.id}:${ALARM_KIND}`) &&
          c.scheduledAt !== null &&
          c.scheduledAt < alarmCutoff.toISOString()
      )

      // ── 4. Addresses (one query) + admin ids ──────────────────────────
      const propertyIds = Array.from(
        new Set(
          [...nudgeJobs, ...alarmJobs]
            .map((c) => c.propertyId)
            .filter((p): p is string => Boolean(p))
        )
      )
      const propertyRows = propertyIds.length
        ? await tx
            .select({
              id: properties.id,
              addressLine1: properties.addressLine1,
              postcode: properties.postcode,
            })
            .from(properties)
            .where(inArray(properties.id, propertyIds))
        : []
      const propertyById = new Map(propertyRows.map((p) => [p.id, p]))

      const admins =
        alarmJobs.length > 0
          ? (
              await tx
                .select({ userId: userRoles.userId })
                .from(userRoles)
                .where(eq(userRoles.role, 'admin'))
            ).map((a) => a.userId)
          : []

      const describe = (c: (typeof missing)[number]) => {
        const prop = c.propertyId ? propertyById.get(c.propertyId) : null
        return prop?.addressLine1
          ? `${prop.addressLine1}${prop.postcode ? ' · ' + prop.postcode : ''}`
          : 'the scheduled property'
      }

      return {
        nudges: nudgeJobs.map((c) => ({
          jobId: c.id,
          assigneeId: c.clerkId ?? c.cleanerId,
          address: describe(c),
        })),
        alarms: alarmJobs.map((c) => ({
          jobId: c.id,
          address: describe(c),
        })),
        admins,
      }
    })

    // ── 5. Notify the pros (push in-app-banner + SMS) outside any tx ────
    let pushed = 0
    let smsSent = 0
    for (const n of plan.nudges) {
      if (!n.assigneeId) continue
      const push = await sendPushToUser(n.assigneeId, {
        title: 'You haven’t checked in',
        body: `Your appointment at ${n.address} has started. Check in on arrival — or flag that you’re running late.`,
        tag: `job:${n.jobId}:${NUDGE_KIND}`,
        url: `/jobs/${n.jobId}`,
      })
      pushed += push.delivered
      const sms = await notifyUserSms(
        n.assigneeId,
        'smsJobUpdates',
        `LISTD: you haven't checked in for your job at ${n.address}. Open the app to check in or flag that you're running late.`.slice(
          0,
          300
        )
      )
      if (!sms.skipped) smsSent += 1
    }

    // ── 6. Admin alarms + idempotency rows in one follow-up tx ──────────
    await withServiceRole(async (tx) => {
      if (plan.alarms.length > 0 && plan.admins.length > 0) {
        await tx.insert(notifications).values(
          plan.alarms.flatMap((a) =>
            plan.admins.map((adminId) => ({
              userId: adminId,
              type: 'system',
              title: 'Possible no-show',
              message: `Job ${a.jobId.slice(0, 8)} at ${a.address}: no check-in ${ALARM_AFTER_MIN}+ min after the scheduled time. Confirm before any penalty (framework A1).`,
              link: `/admin/jobs/${a.jobId}`,
            }))
          )
        )
      }
      const rows = [
        ...plan.nudges.map((n) => ({ jobId: n.jobId, kind: NUDGE_KIND })),
        ...plan.alarms.map((a) => ({ jobId: a.jobId, kind: ALARM_KIND })),
      ]
      if (rows.length > 0) {
        await tx
          .insert(appointmentRemindersSent)
          .values(
            rows.map((r) => ({
              ...r,
              recipientCount: 1,
              emailSentCount: 0,
              emailSkippedCount: 0,
            }))
          )
          .onConflictDoNothing()
      }
    })

    return ok({
      ok: true,
      nudged: plan.nudges.length,
      alarmed: plan.alarms.length,
      pushesDelivered: pushed,
      smsSent,
    })
  } catch (err) {
    console.error('[missed-checkin] error:', err)
    return errorResponse(err)
  }
}
