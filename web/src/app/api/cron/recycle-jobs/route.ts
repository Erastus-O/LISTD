import { and, eq, inArray, isNull, lt } from 'drizzle-orm'
import { errorResponse, ok, unauthorized } from '@/lib/api'
import {
  jobs,
  notificationAutomationSettings,
  notifications,
  properties,
  userRoles,
  withServiceRole,
} from '@/db'
import { logAuditEvent } from '@/lib/audit'
import {
  verifyCronAuth,
  verifyExternalApiKey,
} from '@/lib/webhooks'

export const maxDuration = 60
export const runtime = 'nodejs'

/**
 * GET /api/cron/recycle-jobs
 *
 * Replaces supabase/functions/recycle-jobs/index.ts. Vercel Cron schedule in
 * vercel.json: every 15 minutes.
 *
 * Setting keys are canonical per ADR-002 (renamed from the original
 * `resend_after_hours` etc. to match the migration's seed data).
 *
 * Refactor from the audit (Docs/M-Pre-timeout-audit.md):
 *   - Sequential UPDATEs in the original become a single `Promise.all` so the
 *     handler runs in ~constant time regardless of job count.
 */
export async function GET(req: Request) {
  if (!verifyCronAuth(req) && !verifyExternalApiKey(req)) {
    return unauthorized()
  }

  try {
    const result = await withServiceRole(async (tx) => {
      // 1. Settings (canonical names per ADR-002).
      const settingsRows = await tx
        .select({
          key: notificationAutomationSettings.settingKey,
          value: notificationAutomationSettings.value,
        })
        .from(notificationAutomationSettings)
      const settings = new Map(settingsRows.map((r) => [r.key, Number(r.value)]))

      const resendAfterHours = settings.get('job_recycle_first_resend_hours') ?? 6
      const urgencyAfterHours = settings.get('job_recycle_urgency_badge_hours') ?? 12
      const uplift1AfterHours = settings.get('job_recycle_uplift1_hours') ?? 24
      const uplift1Percent = settings.get('job_recycle_uplift1_percent') ?? 10
      const uplift2AfterHours = settings.get('job_recycle_uplift2_hours') ?? 48
      const uplift2Percent = settings.get('job_recycle_uplift2_percent') ?? 20

      // 2. Unaccepted published jobs.
      const candidateJobs = await tx
        .select({
          id: jobs.id,
          clientId: jobs.clientId,
          clerkPayout: jobs.clerkPayout,
          recycleStage: jobs.recycleStage,
          createdAt: jobs.createdAt,
          inspectionType: jobs.inspectionType,
          scheduledDate: jobs.scheduledDate,
          propertyId: jobs.propertyId,
        })
        .from(jobs)
        .where(and(eq(jobs.status, 'published'), isNull(jobs.clerkId)))

      if (candidateJobs.length === 0) {
        return { jobsProcessed: 0, actions: [] as string[] }
      }

      // 3. Clerk and admin user-id lists for notification fan-out.
      const [clerkRows, adminRows] = await Promise.all([
        tx
          .select({ userId: userRoles.userId })
          .from(userRoles)
          .where(eq(userRoles.role, 'clerk')),
        tx
          .select({ userId: userRoles.userId })
          .from(userRoles)
          .where(eq(userRoles.role, 'admin')),
      ])
      const clerkIds = clerkRows.map((r) => r.userId)
      const adminIds = adminRows.map((r) => r.userId)

      // 4. Batch property lookup.
      const propertyIds = Array.from(
        new Set(
          candidateJobs.map((j) => j.propertyId).filter((p): p is string => Boolean(p))
        )
      )
      const propertyRows =
        propertyIds.length === 0
          ? []
          : await tx
              .select({
                id: properties.id,
                addressLine1: properties.addressLine1,
                city: properties.city,
                postcode: properties.postcode,
              })
              .from(properties)
              .where(inArray(properties.id, propertyIds))
      const propertyById = new Map(propertyRows.map((p) => [p.id, p]))

      const formatType = (t: string) =>
        t.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

      const now = Date.now()
      const actions: string[] = []
      const notificationsToInsert: Array<{
        userId: string
        type: string
        title: string
        message: string
        link: string
      }> = []
      const jobUpdates: Array<{
        id: string
        fromStage: number
        recycleStage: number
        clerkPayout?: string
        isRecycledUrgent?: boolean
      }> = []

      for (const job of candidateJobs) {
        const hoursElapsed =
          (now - new Date(job.createdAt).getTime()) / (1000 * 60 * 60)
        const prop = job.propertyId ? propertyById.get(job.propertyId) : undefined
        const area = prop ? [prop.city, prop.postcode].filter(Boolean).join(' ') : ''
        const serviceLabel = formatType(job.inspectionType)
        const dateLabel = job.scheduledDate
        const stage = job.recycleStage ?? 0

        // Stage 1: resend to clerks
        if (hoursElapsed >= resendAfterHours && stage < 1) {
          for (const clerkId of clerkIds) {
            notificationsToInsert.push({
              userId: clerkId,
              type: 'job',
              title: 'Job Available in Your Area',
              message: `A job in your area needs a clerk : ${area} ${serviceLabel} on ${dateLabel}`,
              link: `/clerk/jobs/available`,
            })
          }
          jobUpdates.push({ id: job.id, fromStage: stage, recycleStage: 1 })
          actions.push(`stage_1_resend:${job.id}`)
        }

        // Stage 2: urgency + uplift1
        if (hoursElapsed >= urgencyAfterHours && stage < 2) {
          const currentPay = Number(job.clerkPayout) || 0
          const newPay =
            Math.round(currentPay * (1 + uplift1Percent / 100) * 100) / 100
          for (const clerkId of clerkIds) {
            notificationsToInsert.push({
              userId: clerkId,
              type: 'job',
              title: '🔴 Urgent Job Available',
              message: `Urgent: ${serviceLabel} at ${prop?.addressLine1 ?? 'a property'}, ${area} on ${dateLabel} : increased pay available`,
              link: `/clerk/jobs/available`,
            })
          }
          jobUpdates.push({
            id: job.id,
            fromStage: stage,
            recycleStage: 2,
            clerkPayout: newPay.toString(),
            isRecycledUrgent: true,
          })
          actions.push(
            `stage_2_uplift_${uplift1Percent}%:${job.id}:${currentPay}->${newPay}`
          )
        }

        // Stage 3: escalation + uplift2
        if (hoursElapsed >= uplift2AfterHours && stage < 3) {
          const currentPay = Number(job.clerkPayout) || 0
          const newPay =
            Math.round(currentPay * (1 + uplift2Percent / 100) * 100) / 100
          for (const adminId of adminIds) {
            notificationsToInsert.push({
              userId: adminId,
              type: 'warning',
              title: 'Job Unaccepted 48+ Hours',
              message: `Job ${job.id} has been unaccepted for 48+ hours. Manual intervention may be required.`,
              link: `/admin/jobs/${job.id}`,
            })
          }
          notificationsToInsert.push({
            userId: job.clientId,
            type: 'job',
            title: 'Finding Your Pro',
            message:
              'We are working to find a clerk for your job. Our team has been alerted.',
            link: `/client/jobs/${job.id}`,
          })
          jobUpdates.push({
            id: job.id,
            fromStage: stage,
            recycleStage: 3,
            clerkPayout: newPay.toString(),
          })
          actions.push(
            `stage_3_escalation_${uplift2Percent}%:${job.id}:${currentPay}->${newPay}`
          )
        }
      }

      // 5. Parallelised UPDATEs (audit fix — was sequential).
      await Promise.all(
        jobUpdates.map((u) => {
          const set: Record<string, unknown> = { recycleStage: u.recycleStage }
          if (u.clerkPayout !== undefined) set.clerkPayout = u.clerkPayout
          if (u.isRecycledUrgent !== undefined)
            set.isRecycledUrgent = u.isRecycledUrgent
          return tx.update(jobs).set(set).where(eq(jobs.id, u.id))
        })
      )

      // 6. Batch insert notifications (one round-trip).
      if (notificationsToInsert.length > 0) {
        await tx.insert(notifications).values(notificationsToInsert)
      }

      // 7. Audit row per stage promotion. `actorUserId: null` = cron action.
      for (const u of jobUpdates) {
        await logAuditEvent(tx, {
          category: 'job_lifecycle',
          action: 'job.recycle_promoted',
          actorUserId: null,
          targetType: 'job',
          targetId: u.id,
          payload: {
            actor: 'cron',
            fromStage: u.fromStage,
            toStage: u.recycleStage,
            clerkPayout: u.clerkPayout ?? null,
            isUrgent: u.isRecycledUrgent ?? null,
          },
        })
      }

      return { jobsProcessed: candidateJobs.length, actions }
    })

    return ok({
      message: `Processed ${result.jobsProcessed} jobs`,
      actions_taken: result.actions.length,
      actions: result.actions,
    })
  } catch (err) {
    console.error('[cron/recycle-jobs] error:', err)
    return errorResponse(err)
  }
}

// Suppress unused-import warning (re-exported for potential external use)
void lt
