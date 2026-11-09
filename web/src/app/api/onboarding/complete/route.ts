import { eq } from 'drizzle-orm'
import { errorResponse, ok } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import { profiles, withServiceRole } from '@/db'

export const maxDuration = 10
export const runtime = 'nodejs'

/**
 * POST /api/onboarding/complete — flip the caller's profile.onboarding_completed flag.
 *
 * Phase-1 minimum: lets the post-signin flow advance to a dashboard. The full
 * multi-step onboarding (terms, signature, organisation details, clerk
 * verification docs) is M1 work — see [LISTD_Project_Plan_v0.1.md](../../../../../Docs/LISTD_Project_Plan_v0.1.md) M1.
 */
export async function POST() {
  const session = await authorizeRequest()
  if (session instanceof Response) return session

  try {
    await withServiceRole(async (tx) =>
      tx
        .update(profiles)
        .set({ onboardingCompleted: true })
        .where(eq(profiles.userId, session.userId))
    )
    return ok({ success: true })
  } catch (err) {
    return errorResponse(err)
  }
}
