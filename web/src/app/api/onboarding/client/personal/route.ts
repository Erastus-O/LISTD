import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { errorResponse, ok } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import { profiles, withServiceRole } from '@/db'
import { ukPhone } from '@/lib/uk-phone'

export const maxDuration = 10
export const runtime = 'nodejs'

const ROLE_SUBTYPES = [
  'letting_agent',
  'landlord',
  'housing_association',
  'other',
] as const

const RequestSchema = z
  .object({
    fullName: z.string().trim().min(1).max(100),
    phone: ukPhone,
    roleSubtype: z.enum(ROLE_SUBTYPES),
  })
  .strict()

/**
 * PATCH /api/onboarding/client/personal — save Step 1 of the 3-step client
 * onboarding (PRD §5.1, US-005). Updates the caller's own profile row.
 */
export async function PATCH(req: Request) {
  const session = await authorizeRequest()
  if (session instanceof Response) return session

  try {
    const body = await req.json()
    const { fullName, phone, roleSubtype } = RequestSchema.parse(body)

    // Service-role bypass: the caller is authenticated and we constrain the
    // update to `profiles.userId = session.userId`. RLS would also allow this
    // via the "Users can update their own profile" policy, but going through
    // service-role keeps the handler symmetrical with the rest of /api/onboarding.
    await withServiceRole(async (tx) =>
      tx
        .update(profiles)
        .set({ fullName, phone, roleSubtype })
        .where(eq(profiles.userId, session.userId))
    )

    return ok({ success: true })
  } catch (err) {
    return errorResponse(err)
  }
}
