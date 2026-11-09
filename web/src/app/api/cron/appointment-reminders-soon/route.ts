import { and, eq, gte, inArray, isNotNull, lt } from 'drizzle-orm'
import { errorResponse, ok, unauthorized } from '@/lib/api'
import {
  appointmentRemindersSent,
  jobs,
  properties,
  withServiceRole,
} from '@/db'
import { sendPushToUser } from '@/lib/push'
import { verifyCronAuth, verifyExternalApiKey } from '@/lib/webhooks'

export const maxDuration = 60
export const runtime = 'nodejs'

/**
 * GET /api/cron/appointment-reminders-soon
 *
 * Vercel Cron — every 10 minutes. Sends a push notification to the
 * assigned clerk for any job whose `scheduled_at` falls inside a
 * 2-hour-forward window. Companion to the daily
 * `appointment-reminders` cron which handles the email-based day-before
 * reminder.
 *
 * **Push, not email.** A 2-hour-out reminder is route-planning context
 * for a clerk who's getting ready to leave. Email at that latency is
 * the wrong channel — push to the installed PWA lands on the lock
 * screen with the right time-to-attention.
 *
 * **Clerk only.** Clients and org owners get the day-before email; they
 * don't get a 2h push, because the threat-model is "client checks
 * inbox once a day" not "client checks phone obsessively". Adding
 * client pushes is a one-line addition if you later want it.
 *
 * **Schedule + window.** Runs every 10 minutes; selects jobs where
 * `scheduled_at` is between (now + 1h55m) and (now + 2h5m). That
 * 10-minute window plus the every-10-minute cadence means each job
 * lands in the window exactly once. Drift from cron-jitter (e.g.
 * Vercel running it at 02:03 instead of 02:00) is absorbed by the
 * idempotency key — at worst we miss a single window for a single job,
 * which the unique constraint will re-allow on the next run.
 *
 * **Idempotency** is the same table the daily reminder uses, with
 * `kind = 'two_hour_before'`. Reruns short-circuit before touching the
 * push provider.
 *
 * **No-time-yet jobs.** `scheduled_at` is nullable — rows without one
 * are skipped here. Falling back to date+slot parsing would silently
 * coerce ambiguous data into precise timestamps; better to make the
 * booking flow + admin reschedule UI write `scheduled_at` than to
 * guess.
 */

const REMINDER_KIND = 'two_hour_before' as const
const WINDOW_MINUTES = 5 // ±5min window centered on the 2h mark
const TARGET_HOURS_AHEAD = 2

const ACTIVE_STATUSES = ['accepted', 'assigned', 'in_progress'] as const

const INSPECTION_LABELS: Record<string, string> = {
  new_inventory: 'New Inventory',
  check_in: 'Check-In',
  check_out: 'Check-Out',
  mid_term: 'Mid-Term',
  interim: 'Interim',
}

export async function GET(req: Request) {
  if (!verifyCronAuth(req) && !verifyExternalApiKey(req)) {
    return unauthorized()
  }

  try {
    const now = Date.now()
    const target = new Date(now + TARGET_HOURS_AHEAD * 60 * 60 * 1000)
    const windowStart = new Date(target.getTime() - WINDOW_MINUTES * 60 * 1000)
    const windowEnd = new Date(target.getTime() + WINDOW_MINUTES * 60 * 1000)

    const result = await withServiceRole(async (tx) => {
      // ── 1. Candidates: assigned jobs with scheduled_at in the window ───
      const candidates = await tx
        .select({
          id: jobs.id,
          clerkId: jobs.clerkId,
          propertyId: jobs.propertyId,
          inspectionType: jobs.inspectionType,
          scheduledAt: jobs.scheduledAt,
          preferredTimeSlot: jobs.preferredTimeSlot,
          accessMethod: jobs.accessMethod,
        })
        .from(jobs)
        .where(
          and(
            isNotNull(jobs.scheduledAt),
            isNotNull(jobs.clerkId),
            gte(jobs.scheduledAt, windowStart.toISOString()),
            lt(jobs.scheduledAt, windowEnd.toISOString()),
            inArray(jobs.status, [...ACTIVE_STATUSES])
          )
        )

      if (candidates.length === 0) {
        return { jobsReminded: 0, pushesAttempted: 0, pushesDelivered: 0, pushesPruned: 0, pushesFailed: 0 }
      }

      // ── 2. De-dupe against the idempotency table ────────────────────────
      const candidateIds = candidates.map((c) => c.id)
      const alreadySent = await tx
        .select({ jobId: appointmentRemindersSent.jobId })
        .from(appointmentRemindersSent)
        .where(
          and(
            eq(appointmentRemindersSent.kind, REMINDER_KIND),
            inArray(appointmentRemindersSent.jobId, candidateIds)
          )
        )
      const alreadySentSet = new Set(alreadySent.map((r) => r.jobId))
      const surviving = candidates.filter((c) => !alreadySentSet.has(c.id))
      if (surviving.length === 0) {
        return { jobsReminded: 0, pushesAttempted: 0, pushesDelivered: 0, pushesPruned: 0, pushesFailed: 0 }
      }

      // ── 3. Resolve addresses (one query, not N+1) ───────────────────────
      const propertyIds = Array.from(
        new Set(
          surviving.map((c) => c.propertyId).filter((p): p is string => Boolean(p))
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

      // ── 4. Fan out pushes ──────────────────────────────────────────────
      let attempted = 0
      let delivered = 0
      let pruned = 0
      let failed = 0
      const recordsToInsert: Array<{
        jobId: string
        kind: string
        recipientCount: number
        emailSentCount: number
        emailSkippedCount: number
      }> = []

      for (const job of surviving) {
        if (!job.clerkId) continue
        const prop = job.propertyId ? propertyById.get(job.propertyId) : null
        const shortAddress = prop?.addressLine1
          ? `${prop.addressLine1}${prop.postcode ? ' · ' + prop.postcode : ''}`
          : 'your scheduled property'
        const label = INSPECTION_LABELS[job.inspectionType] ?? job.inspectionType

        const push = await sendPushToUser(job.clerkId, {
          title: `${label} in ~2 hours`,
          body: shortAddress,
          // Tag on (jobId, kind) — replaces any prior banner for the
          // same job/kind so a re-fire doesn't stack notifications.
          tag: `job:${job.id}:${REMINDER_KIND}`,
          url: `/jobs/${job.id}`,
        })

        attempted += push.attempted
        delivered += push.delivered
        pruned += push.pruned
        failed += push.failed

        recordsToInsert.push({
          jobId: job.id,
          kind: REMINDER_KIND,
          recipientCount: 1, // clerk-only fan-out for now
          // Reuse the email columns to record push outcomes — saves
          // adding a parallel set of columns just for this kind. The
          // semantic mapping: emailSentCount = pushes delivered,
          // emailSkippedCount = pushes that failed or got pruned.
          emailSentCount: push.delivered,
          emailSkippedCount: push.pruned + push.failed,
        })
      }

      // ── 5. Persist the idempotency rows ─────────────────────────────────
      // onConflictDoNothing on (jobId, kind) — if a concurrent run hit
      // the same job we don't fail; the unique constraint protects us.
      if (recordsToInsert.length > 0) {
        await tx
          .insert(appointmentRemindersSent)
          .values(recordsToInsert)
          .onConflictDoNothing()
      }

      return {
        jobsReminded: surviving.length,
        pushesAttempted: attempted,
        pushesDelivered: delivered,
        pushesPruned: pruned,
        pushesFailed: failed,
      }
    })

    return ok({ ok: true, kind: REMINDER_KIND, ...result })
  } catch (err) {
    console.error('[appointment-reminders-soon] error:', err)
    return errorResponse(err)
  }
}
