import { desc, gte } from 'drizzle-orm'
import { errorResponse, ok, unauthorized } from '@/lib/api'
import { jobs, withServiceRole } from '@/db'
import { verifyExternalApiKey } from '@/lib/webhooks'

export const maxDuration = 30
export const runtime = 'nodejs'

/**
 * GET /api/jobs/new — jobs created in the last 15 minutes.
 * Replaces supabase/functions/get-new-jobs/index.ts.
 *
 * Authenticated by EXTERNAL_API_KEY (no Supabase JWT). Service-role bypass
 * intentional per ADR-001.
 */
export async function GET(req: Request) {
  if (!verifyExternalApiKey(req)) return unauthorized()

  try {
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString()

    const data = await withServiceRole(async (tx) =>
      tx
        .select({
          id: jobs.id,
          inspectionType: jobs.inspectionType,
          scheduledDate: jobs.scheduledDate,
          status: jobs.status,
          serviceTier: jobs.serviceTier,
          preferredTimeSlot: jobs.preferredTimeSlot,
          specialInstructions: jobs.specialInstructions,
          createdAt: jobs.createdAt,
          propertyId: jobs.propertyId,
        })
        .from(jobs)
        .where(gte(jobs.createdAt, fifteenMinutesAgo))
        .orderBy(desc(jobs.createdAt))
    )

    return ok({ jobs: data, count: data.length })
  } catch (err) {
    console.error('[jobs/new] error:', err)
    return errorResponse(err)
  }
}
