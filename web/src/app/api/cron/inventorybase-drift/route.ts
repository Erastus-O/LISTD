import { and, eq, isNotNull, notInArray, sql } from 'drizzle-orm'
import { errorResponse, ok, unauthorized } from '@/lib/api'
import {
  jobs,
  notifications,
  userRoles,
  withServiceRole,
} from '@/db'
import {
  extractDate,
  fetchIcalEvents,
  getIcalUrl,
  icalDateToISO,
} from '@/lib/inventorybase'
import {
  verifyCronAuth,
  verifyExternalApiKey,
} from '@/lib/webhooks'

export const maxDuration = 60
export const runtime = 'nodejs'

/**
 * GET /api/cron/inventorybase-drift
 *
 * M2 #8 / R7 mitigation — hourly drift check between LISTD jobs and the IB
 * iCal calendar for IB-linked clerks. For every LISTD job carrying an
 * `inventorybase_job_id`, compare the live calendar event against the LISTD
 * row and alert on mismatch.
 *
 * Detected drift types:
 *   - `missing_in_ib`   — LISTD links a UID, but the iCal feed no longer
 *                         carries that UID (event deleted from IB).
 *   - `date_mismatch`   — IB event's dtstart date ≠ LISTD scheduled_date.
 *
 * Alerts go in-app to admins, idempotent per (job, drift type, day) using
 * the same dedupe pattern as /api/cron/clerk-doc-expiry.
 *
 * Vercel Cron schedule: hourly (`5 * * * *` to avoid colliding with the
 * top-of-hour spike).
 */
export async function GET(req: Request) {
  if (!verifyCronAuth(req) && !verifyExternalApiKey(req)) {
    return unauthorized()
  }

  try {
    const calendarUrl = getIcalUrl()
    if (!calendarUrl) {
      return ok({ message: 'INVENTORYBASE_CALENDAR_KEY not set; skipping' })
    }

    const events = await fetchIcalEvents(calendarUrl)
    const eventByUid = new Map(events.map((e) => [e.uid, e]))

    const result = await withServiceRole(async (tx) => {
      // 1) Linked jobs that are still in motion. Cancelled / paid jobs are
      //    expected to no longer carry a live IB event.
      const linked = await tx
        .select({
          id: jobs.id,
          inventorybaseJobId: jobs.inventorybaseJobId,
          scheduledDate: jobs.scheduledDate,
          status: jobs.status,
        })
        .from(jobs)
        .where(
          and(
            isNotNull(jobs.inventorybaseJobId),
            notInArray(jobs.status, ['cancelled', 'paid'])
          )
        )

      const drift: Array<{
        jobId: string
        uid: string
        reason: 'missing_in_ib' | 'date_mismatch'
        details: string
      }> = []

      for (const job of linked) {
        const uid = job.inventorybaseJobId!
        const event = eventByUid.get(uid)
        if (!event) {
          drift.push({
            jobId: job.id,
            uid,
            reason: 'missing_in_ib',
            details: `IB UID ${uid} no longer present in calendar`,
          })
          continue
        }
        const ibDate = extractDate(icalDateToISO(event.dtstart))
        if (ibDate && ibDate !== job.scheduledDate) {
          drift.push({
            jobId: job.id,
            uid,
            reason: 'date_mismatch',
            details: `LISTD ${job.scheduledDate} vs IB ${ibDate}`,
          })
        }
      }

      if (drift.length === 0) {
        return { driftCount: 0, alertsInserted: 0, drift: [] as typeof drift }
      }

      // 2) Admins to alert.
      const admins = await tx
        .select({ userId: userRoles.userId })
        .from(userRoles)
        .where(eq(userRoles.role, 'admin'))

      let alertsInserted = 0
      if (admins.length > 0) {
        const todayStart = sql`date_trunc('day', now())`
        const existingToday = await tx.execute(sql`
          select user_id, title, link from ${notifications}
          where type = 'ib_drift'
            and created_at >= ${todayStart}
        `)
        const seen = new Set(
          (existingToday as unknown as Array<{ user_id: string; title: string; link: string }>).map(
            (r) => `${r.user_id}:${r.title}:${r.link}`
          )
        )

        const fresh: Array<typeof notifications.$inferInsert> = []
        for (const adminRow of admins) {
          for (const d of drift) {
            const link = `/admin/jobs/${d.jobId}`
            const title =
              d.reason === 'missing_in_ib'
                ? 'IB calendar event missing'
                : 'IB calendar date mismatch'
            const key = `${adminRow.userId}:${title}:${link}`
            if (seen.has(key)) continue
            seen.add(key)
            fresh.push({
              userId: adminRow.userId,
              type: 'ib_drift',
              title,
              message: `Job ${d.jobId.slice(0, 8)} drift: ${d.details}`,
              link,
            })
          }
        }
        if (fresh.length > 0) {
          await tx.insert(notifications).values(fresh)
          alertsInserted = fresh.length
        }
      }

      return { driftCount: drift.length, alertsInserted, drift }
    })

    return ok({
      success: true,
      eventsParsed: events.length,
      driftCount: result.driftCount,
      alertsInserted: result.alertsInserted,
      drift: result.drift.slice(0, 50),
    })
  } catch (err) {
    console.error('[cron/inventorybase-drift] error:', err)
    return errorResponse(err)
  }
}
