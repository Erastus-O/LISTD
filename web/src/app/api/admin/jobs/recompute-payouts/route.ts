import { and, eq, or, sql } from 'drizzle-orm'
import { errorResponse, ok } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import { jobs, properties, withServiceRole } from '@/db'
import { logAuditEvent } from '@/lib/audit'
import { getEffectivePricing } from '@/lib/pricing-settings'
import {
  computeClerkPayout,
  type FurnishedStatus,
  type PropertySize,
  type ServiceTier,
} from '@/lib/pricing-matrix'

export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * POST /api/admin/jobs/recompute-payouts — backfill clerk pay for jobs
 * whose `clerk_payout` is still 0 (legacy rows created before clerk-pay
 * computation existed, or any that slipped through at £0). Recomputes
 * from the job's services/tier + the property's size/furnishing/feature
 * counts via the same `computeClerkPayout` the booking flow uses, and
 * writes the itemised breakdown.
 *
 * Skips jobs that are locked (`clerk_payout_locked`) or already have a
 * final payout set (`clerk_final_payout` > 0) so an admin override is
 * never clobbered. Idempotent — re-running only touches rows still at 0.
 */
export async function POST(_req: Request) {
  const session = await authorizeRequest('admin')
  if (session instanceof Response) return session

  try {
    const pricing = await getEffectivePricing()

    const result = await withServiceRole(async (tx) => {
      // Candidate rows: payout 0 / null, not locked, no final payout.
      const rows = await tx
        .select({
          id: jobs.id,
          inspectionType: jobs.inspectionType,
          inspectionTypes: jobs.inspectionTypes,
          serviceTier: jobs.serviceTier,
          // property features that drive the payout add-ons
          propertyType: properties.propertyType,
          furnishedStatus: properties.furnishedStatus,
          bathrooms: properties.bathrooms,
          kitchens: properties.kitchens,
          utilityRooms: properties.utilityRooms,
          storageRooms: properties.storageRooms,
          hallwaysStairs: properties.hallwaysStairs,
          gardens: properties.gardens,
          communalAreas: properties.communalAreas,
          heavilyFurnished: properties.heavilyFurnished,
        })
        .from(jobs)
        .innerJoin(properties, eq(properties.id, jobs.propertyId))
        .where(
          and(
            or(
              sql`${jobs.clerkPayout} IS NULL`,
              sql`${jobs.clerkPayout}::numeric = 0`
            ),
            sql`coalesce(${jobs.clerkPayoutLocked}, false) = false`,
            or(
              sql`${jobs.clerkFinalPayout} IS NULL`,
              sql`${jobs.clerkFinalPayout}::numeric = 0`
            )
          )
        )
        .limit(1000)

      let updated = 0
      let skipped = 0
      for (const r of rows) {
        const services =
          r.inspectionTypes && r.inspectionTypes.length > 0
            ? r.inspectionTypes
            : [r.inspectionType]
        // Tiered services store a real tier; 'standard' (non-tiered jobs)
        // is harmless for the flat check-in/interim payouts. Coerce
        // anything that isn't a matrix tier to 'core' as a safe default.
        const tier: ServiceTier =
          r.serviceTier === 'flex' || r.serviceTier === 'priority'
            ? r.serviceTier
            : 'core'
        const size = r.propertyType as PropertySize
        const furnishing = r.furnishedStatus as FurnishedStatus

        const payout = computeClerkPayout(pricing, services, size, tier, furnishing, {
          bathrooms: r.bathrooms,
          kitchens: r.kitchens,
          utilityRooms: r.utilityRooms,
          storageRooms: r.storageRooms,
          hallwaysStairs: r.hallwaysStairs,
          gardens: r.gardens,
          communalAreas: r.communalAreas,
          heavilyFurnished: r.heavilyFurnished,
        })

        if (payout.total <= 0) {
          skipped += 1
          continue
        }

        await tx
          .update(jobs)
          .set({
            clerkPayout: payout.total.toString(),
            clerkPayoutBreakdown: {
              source: 'rate_card_backfill',
              computedAt: new Date().toISOString(),
              lines: payout.breakdown,
            },
            updatedAt: sql`now()`,
          })
          .where(eq(jobs.id, r.id))
        updated += 1
      }

      await logAuditEvent(tx, {
        category: 'pricing_override',
        action: 'clerk_payout.backfilled',
        actorUserId: session.userId,
        targetType: 'job',
        targetId: 'bulk',
        payload: { candidates: rows.length, updated, skipped },
      })

      return { candidates: rows.length, updated, skipped }
    })

    return ok({ success: true, ...result })
  } catch (err) {
    console.error('[admin/jobs/recompute-payouts] error:', err)
    return errorResponse(err)
  }
}
