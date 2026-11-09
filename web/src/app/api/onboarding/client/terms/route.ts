import { eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { errorResponse, ok } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import { profiles, withServiceRole } from '@/db'

export const maxDuration = 10
export const runtime = 'nodejs'

const RequestSchema = z
  .object({
    // Type-to-sign signature. Must match the user's profile.full_name to
    // demonstrate intent — same legal weight as DocuSign's typed-signature mode.
    signature: z.string().trim().min(2).max(100),
    confirmed: z.literal(true),
  })
  .strict()

/**
 * POST /api/onboarding/client/terms — Step 3: signs the LISTD Pro Terms of
 * Business and flips `profiles.terms_of_business_signed_at` (PRD §5.1, US-005).
 *
 * Job posting at `/book` is gated on this timestamp being non-null.
 */
export async function POST(req: Request) {
  const session = await authorizeRequest()
  if (session instanceof Response) return session

  try {
    const { signature } = RequestSchema.parse(await req.json())

    // Loose match: signed name must equal the profile's stored full_name,
    // case- and whitespace-insensitive. Forces the user to acknowledge the
    // identity on file rather than scribble anything.
    const expected = (session.profile?.fullName ?? '').trim().toLowerCase()
    if (!expected) {
      return Response.json(
        { error: 'Complete Step 1 (Personal Details) before signing.' },
        { status: 400 }
      )
    }
    if (signature.trim().toLowerCase() !== expected) {
      return Response.json(
        { error: 'Signature must match the full name on your profile.' },
        { status: 400 }
      )
    }

    await withServiceRole(async (tx) =>
      tx
        .update(profiles)
        .set({
          termsOfBusinessSignedAt: sql`now()`,
          onboardingCompleted: true,
        })
        .where(eq(profiles.userId, session.userId))
    )

    return ok({ success: true })
  } catch (err) {
    return errorResponse(err)
  }
}
