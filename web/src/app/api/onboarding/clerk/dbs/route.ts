import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { errorResponse, ok } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import { profiles, withServiceRole } from '@/db'

export const maxDuration = 10
export const runtime = 'nodejs'

const RequestSchema = z
  .object({
    dbsCertificateUrl: z.string().min(1).max(500),
    dbsExpiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .strict()

/**
 * PATCH /api/onboarding/clerk/dbs — Step 3: DBS certificate upload + expiry.
 *
 * The expiry is non-optional here because the M1 #9 cron uses it to drive
 * 60-day pre-expiry prompts and post-expiry auto-suspension.
 */
export async function PATCH(req: Request) {
  const session = await authorizeRequest()
  if (session instanceof Response) return session

  try {
    const { dbsCertificateUrl, dbsExpiry } = RequestSchema.parse(
      await req.json()
    )

    await withServiceRole(async (tx) =>
      tx
        .update(profiles)
        .set({ dbsCertificateUrl, dbsExpiry })
        .where(eq(profiles.userId, session.userId))
    )

    return ok({ success: true })
  } catch (err) {
    return errorResponse(err)
  }
}
