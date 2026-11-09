import { and, eq, inArray, lte } from 'drizzle-orm'
import { errorResponse, ok, unauthorized } from '@/lib/api'
import {
  jobs,
  notificationAutomationSettings,
  notifications,
  properties,
  upsellNotificationsSent,
  withServiceRole,
} from '@/db'
import {
  verifyCronAuth,
  verifyExternalApiKey,
} from '@/lib/webhooks'

export const maxDuration = 60
export const runtime = 'nodejs'

/**
 * GET /api/cron/upsell-reminders
 *
 * Replaces supabase/functions/upsell-reminders/index.ts. Vercel Cron schedule
 * in vercel.json: daily at 09:00 UTC.
 *
 * Setting keys are canonical per ADR-002.
 *
 * Refactor from the audit (Docs/M-Pre-timeout-audit.md):
 *   - Original was N+1 (5 queries per candidate job × 3 rules). This rewrite
 *     does 5 queries flat per rule (15 total) regardless of candidate count.
 *     For ~500 eligible jobs the runtime drops from ~75s to ~1s.
 */
export async function GET(req: Request) {
  if (!verifyCronAuth(req) && !verifyExternalApiKey(req)) {
    return unauthorized()
  }

  try {
    const result = await withServiceRole(async (tx) => {
      const settingsRows = await tx
        .select({
          key: notificationAutomationSettings.settingKey,
          value: notificationAutomationSettings.value,
        })
        .from(notificationAutomationSettings)
      const settings = new Map(settingsRows.map((r) => [r.key, Number(r.value)]))

      const inventoryToCheckinDays =
        settings.get('upsell_inventory_checkin_days') ?? 14
      const checkinToMidtermDays =
        settings.get('upsell_checkin_midterm_days') ?? 90
      const checkoutToInventoryDays =
        settings.get('upsell_checkout_inventory_days') ?? 30

      const actions: string[] = []

      const runRule = async (
        ruleName: 'upsell_checkin' | 'upsell_midterm' | 'upsell_inventory',
        sourceType: 'new_inventory' | 'check_in' | 'check_out',
        followUpTypes: Array<'check_in' | 'mid_term' | 'new_inventory'>,
        cutoffDays: number,
        title: string,
        messageFor: (address: string) => string
      ) => {
        const cutoffISO = new Date(
          Date.now() - cutoffDays * 24 * 60 * 60 * 1000
        ).toISOString()

        // Q1: candidate jobs of the source inspection type, completed and delivered before the cutoff.
        const candidates = await tx
          .select({
            id: jobs.id,
            clientId: jobs.clientId,
            propertyId: jobs.propertyId,
          })
          .from(jobs)
          .where(
            and(
              eq(jobs.inspectionType, sourceType),
              eq(jobs.status, 'completed'),
              lte(jobs.deliveredAt, cutoffISO)
            )
          )

        if (candidates.length === 0) return

        const candidateIds = candidates.map((c) => c.id)
        const propertyIds = Array.from(
          new Set(
            candidates.map((c) => c.propertyId).filter((p): p is string => Boolean(p))
          )
        )

        // Q2: which jobs have already had this rule sent.
        const alreadySent = await tx
          .select({ jobId: upsellNotificationsSent.jobId })
          .from(upsellNotificationsSent)
          .where(
            and(
              eq(upsellNotificationsSent.ruleName, ruleName),
              inArray(upsellNotificationsSent.jobId, candidateIds)
            )
          )
        const alreadySentSet = new Set(alreadySent.map((r) => r.jobId))

        // Q3: which of these properties already have a follow-up booking.
        const followups =
          propertyIds.length === 0
            ? []
            : await tx
                .select({ propertyId: jobs.propertyId })
                .from(jobs)
                .where(
                  and(
                    inArray(jobs.inspectionType, followUpTypes),
                    inArray(jobs.propertyId, propertyIds)
                  )
                )
        const followupPropertySet = new Set(
          followups
            .map((r) => r.propertyId)
            .filter((p): p is string => Boolean(p))
        )

        const surviving = candidates.filter(
          (c) =>
            !alreadySentSet.has(c.id) &&
            (!c.propertyId || !followupPropertySet.has(c.propertyId))
        )
        if (surviving.length === 0) return

        // Q4: addresses for the surviving candidates.
        const survivingPropertyIds = Array.from(
          new Set(
            surviving.map((c) => c.propertyId).filter((p): p is string => Boolean(p))
          )
        )
        const propertyRows =
          survivingPropertyIds.length === 0
            ? []
            : await tx
                .select({
                  id: properties.id,
                  addressLine1: properties.addressLine1,
                  city: properties.city,
                })
                .from(properties)
                .where(inArray(properties.id, survivingPropertyIds))
        const propertyById = new Map(propertyRows.map((p) => [p.id, p]))

        // Q5: batch insert notifications + recordSent.
        const notificationValues = surviving.map((c) => {
          const prop = c.propertyId ? propertyById.get(c.propertyId) : undefined
          const address = prop
            ? `${prop.addressLine1}, ${prop.city}`
            : 'your property'
          return {
            userId: c.clientId,
            type: 'upsell',
            title,
            message: messageFor(address),
            link: '/book',
          }
        })

        await Promise.all([
          tx.insert(notifications).values(notificationValues),
          tx.insert(upsellNotificationsSent).values(
            surviving.map((c) => ({
              jobId: c.id,
              ruleName,
            }))
          ),
        ])

        for (const c of surviving) {
          actions.push(`${ruleName}:${c.id}`)
        }
      }

      // Rule 1: post-Inventory → remind Check-In
      await runRule(
        'upsell_checkin',
        'new_inventory',
        ['check_in'],
        inventoryToCheckinDays,
        'Time to book your Check-In',
        (addr) =>
          `Your Inventory at ${addr} was completed. Book the Check-In to complete the tenancy start process.`
      )

      // Rule 2: post-Check-In → remind Mid-Term
      await runRule(
        'upsell_midterm',
        'check_in',
        ['mid_term'],
        checkinToMidtermDays,
        'Book your Mid-Term Inspection',
        (addr) => `Book your Mid-Term Inspection for ${addr}.`
      )

      // Rule 3: post-Check-Out → remind new Inventory
      await runRule(
        'upsell_inventory',
        'check_out',
        ['new_inventory'],
        checkoutToInventoryDays,
        'Book your new Inventory',
        (addr) => `New tenancy starting at ${addr}? Book your Inventory now.`
      )

      return { actions }
    })

    return ok({
      success: true,
      actions_taken: result.actions.length,
      actions: result.actions,
    })
  } catch (err) {
    console.error('[cron/upsell-reminders] error:', err)
    return errorResponse(err)
  }
}
