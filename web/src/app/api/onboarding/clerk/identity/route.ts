import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { errorResponse, ok } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import { profiles, withServiceRole } from '@/db'
import { ukPhone } from '@/lib/uk-phone'

export const maxDuration = 10
export const runtime = 'nodejs'

const RequestSchema = z
  .object({
    fullName: z.string().trim().min(1).max(100),
    phone: ukPhone,
    governmentIdUrl: z.string().min(1).max(500),
    governmentIdExpiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    emergencyContactName: z.string().trim().min(1).max(100),
    emergencyContactPhone: ukPhone,
  })
  .strict()

/**
 * PATCH /api/onboarding/clerk/identity — Step 1 of the 5-step clerk
 * verification onboarding (PRD §5.15 / M1 #5).
 *
 * `governmentIdUrl` is the storage object path inside the `clerk-documents`
 * bucket (uploaded directly from the browser via the Supabase JS client).
 */
export async function PATCH(req: Request) {
  const session = await authorizeRequest()
  if (session instanceof Response) return session

  try {
    const body = RequestSchema.parse(await req.json())

    await withServiceRole(async (tx) =>
      tx
        .update(profiles)
        .set({
          fullName: body.fullName,
          phone: body.phone,
          governmentIdUrl: body.governmentIdUrl,
          governmentIdExpiry: body.governmentIdExpiry ?? null,
          emergencyContactName: body.emergencyContactName,
          emergencyContactPhone: body.emergencyContactPhone,
        })
        .where(eq(profiles.userId, session.userId))
    )

    return ok({ success: true })
  } catch (err) {
    return errorResponse(err)
  }
}
