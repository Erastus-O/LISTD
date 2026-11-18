import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { badRequest, errorResponse, ok } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import { profiles, withServiceRole } from '@/db'
import { getBookableServices } from '@/lib/pricing-matrix'
import { getEffectivePricing } from '@/lib/pricing-settings'
import { setProServices } from '@/lib/listd/pro-services-server'

export const maxDuration = 10
export const runtime = 'nodejs'

// Accept any string here — service keys are validated in the handler
// against the live bookable services (built-ins + admin custom types) so
// new types added on /admin/pricing immediately count as valid offerings.
// The old hardcoded `['inventory', 'check_in', 'check_out', 'mid_term',
// 'snagging']` enum was both out of sync ('inventory' vs the booking
// system's 'new_inventory', no 'interim') and silently dropped admin-
// added types.
const RequestSchema = z
  .object({
    coverageAreas: z.array(z.string().trim().min(1).max(10)).min(1).max(50),
    // Empty unless the Pro offers inspections.
    serviceTypesOffered: z.array(z.string()),
    // The services the Pro offers. Each is held as a role (one Pro account).
    categories: z.array(z.enum(['clerk', 'cleaner', 'trades'])).min(1).optional(),
    languages: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
    vehicleDetails: z.string().trim().max(200).optional(),
  })
  .strict()

/**
 * PATCH /api/onboarding/clerk/coverage — Step 2 of clerk verification.
 */
export async function PATCH(req: Request) {
  const session = await authorizeRequest()
  if (session instanceof Response) return session

  try {
    const { coverageAreas, serviceTypesOffered, languages, vehicleDetails, categories } =
      RequestSchema.parse(await req.json())
    const offersInspections = categories ? categories.includes('clerk') : true

    const pricing = await getEffectivePricing()
    const validKeys = new Set(getBookableServices(pricing).map((s) => s.key))
    const filteredServices = Array.from(
      new Set(serviceTypesOffered.filter((v) => validKeys.has(v)))
    )
    if (offersInspections && filteredServices.length === 0) {
      return badRequest('Pick at least one inspection type you can do.')
    }

    if (categories) {
      const kept = await withServiceRole((tx) => setProServices(tx, session.userId, categories))
      if (kept.length) {
        return badRequest(`You still have open ${kept.join(' and ')} jobs, so that service stays on until they finish.`)
      }
    }

    await withServiceRole(async (tx) =>
      tx
        .update(profiles)
        .set({
          coverageAreas: coverageAreas.map((p) => p.toUpperCase()),
          serviceTypesOffered: filteredServices,
          languages: languages ?? null,
          vehicleDetails: vehicleDetails || null,
        })
        .where(eq(profiles.userId, session.userId))
    )

    return ok({ success: true })
  } catch (err) {
    return errorResponse(err)
  }
}
