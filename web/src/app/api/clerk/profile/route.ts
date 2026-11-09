import { eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { errorResponse, ok } from '@/lib/api'
import { authorizeRequest, bustUserSession } from '@/lib/dal'
import { profiles, withServiceRole } from '@/db'
import { getBookableServices } from '@/lib/pricing-matrix'
import { getEffectivePricing } from '@/lib/pricing-settings'

export const maxDuration = 15
export const runtime = 'nodejs'

// Accept any string for service keys here — the handler filters the array
// against the live bookable services (built-ins + admin custom types) so
// new types added on /admin/pricing immediately count as valid offerings.
const RequestSchema = z
  .object({
    fullName: z.string().trim().min(1).max(120),
    phone: z.string().trim().max(40).nullable().optional(),
    // Dedupe + cap server-side. The form filters but legacy data could
    // still send stale enums or repeats — accept anything the form sends,
    // then keep only valid distinct values.
    coverageAreas: z
      .array(z.string().trim().min(1).max(20))
      .max(100)
      .transform((arr) => Array.from(new Set(arr)).slice(0, 50)),
    serviceTypesOffered: z.array(z.string()),
    vehicleDetails: z.string().trim().max(200).nullable().optional(),
    languages: z
      .array(z.string().trim().min(1).max(40))
      .max(100)
      .transform((arr) => Array.from(new Set(arr)).slice(0, 20)),
    emergencyContactName: z.string().trim().max(120).nullable().optional(),
    emergencyContactPhone: z.string().trim().max(40).nullable().optional(),
  })
  .strict()

/**
 * POST /api/clerk/profile — clerk saves editable profile fields. The
 * verification-affecting fields (DBS, insurance, qualification, gov ID)
 * are NOT writable here; they route through the onboarding handlers so any
 * change re-triggers admin verification review.
 *
 * **No audit row** — this is non-state-transition profile maintenance,
 * symmetric with /api/admin/profiles/[userId]/admin-notes. If compliance
 * later asks for diff history (e.g. "show me when this clerk changed their
 * coverage areas"), add a `profile_metadata` audit category in a follow-up.
 */
export async function POST(req: Request) {
  const session = await authorizeRequest('clerk', 'trades', 'admin')
  if (session instanceof Response) return session

  try {
    const body = RequestSchema.parse(await req.json())

    // Filter service keys against the live rate card so stale (e.g.
    // 'inventory', 'snagging') or unknown keys are quietly dropped rather
    // than rejecting the whole save — the form already shows only the
    // valid set, this is belt-and-braces.
    const pricing = await getEffectivePricing()
    const validKeys = new Set(getBookableServices(pricing).map((s) => s.key))
    const serviceTypesOffered = Array.from(
      new Set(body.serviceTypesOffered.filter((v) => validKeys.has(v)))
    )

    await withServiceRole(async (tx) => {
      await tx
        .update(profiles)
        .set({
          fullName: body.fullName,
          phone: body.phone ?? null,
          coverageAreas: body.coverageAreas,
          serviceTypesOffered,
          vehicleDetails: body.vehicleDetails ?? null,
          languages: body.languages,
          emergencyContactName: body.emergencyContactName ?? null,
          emergencyContactPhone: body.emergencyContactPhone ?? null,
          updatedAt: sql`now()`,
        })
        .where(eq(profiles.userId, session.userId))
    })

    await bustUserSession(session.userId)
    return ok({ success: true })
  } catch (err) {
    console.error('[clerk/profile] error:', err)
    return errorResponse(err)
  }
}
