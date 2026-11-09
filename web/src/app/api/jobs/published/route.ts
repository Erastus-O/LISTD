import { desc, eq } from 'drizzle-orm'
import { errorResponse, ok, unauthorized } from '@/lib/api'
import { jobs, properties, withServiceRole } from '@/db'
import { verifyExternalApiKey } from '@/lib/webhooks'

export const maxDuration = 30
export const runtime = 'nodejs'

/**
 * GET /api/jobs/published — published-status jobs for external clerk APIs.
 *
 * Replaces supabase/functions/get-published-jobs/index.ts.
 * Authenticated by EXTERNAL_API_KEY (no Supabase JWT). RLS bypass is intentional
 * per ADR-001 — the API key is the auth boundary, and the caller is a trusted
 * integration partner, not a logged-in user.
 */
export async function GET(req: Request) {
  if (!verifyExternalApiKey(req)) return unauthorized()

  try {
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
          quotedPrice: jobs.quotedPrice,
          finalPrice: jobs.finalPrice,
          createdAt: jobs.createdAt,
          clientId: jobs.clientId,
          propertyId: jobs.propertyId,
          property: {
            addressLine1: properties.addressLine1,
            addressLine2: properties.addressLine2,
            city: properties.city,
            postcode: properties.postcode,
            propertyType: properties.propertyType,
            bedrooms: properties.bedrooms,
            bathrooms: properties.bathrooms,
          },
        })
        .from(jobs)
        .leftJoin(properties, eq(jobs.propertyId, properties.id))
        .where(eq(jobs.status, 'published'))
        .orderBy(desc(jobs.createdAt))
    )

    return ok({ jobs: data, count: data.length })
  } catch (err) {
    console.error('[jobs/published] error:', err)
    return errorResponse(err)
  }
}
