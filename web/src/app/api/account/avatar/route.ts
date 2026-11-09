import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { errorResponse, ok } from '@/lib/api'
import { authorizeRequest, bustUserSession } from '@/lib/dal'
import { profiles, withServiceRole } from '@/db'

export const maxDuration = 10
export const runtime = 'nodejs'

const RequestSchema = z
  .object({
    /** Public URL of the avatar in the `avatars` bucket. Null clears. */
    avatarUrl: z.string().url().max(2000).nullable(),
  })
  .strict()

/**
 * POST /api/account/avatar — save the signed-in user's profile photo URL.
 *
 * The bytes were already uploaded browser-direct to `avatars/<userId>/...`
 * before this request lands (storage RLS limits writes to the caller's own
 * folder); this handler just commits the URL onto `profiles.avatar_url`.
 *
 * No audit row: avatars are surface-level UX rather than a forensic
 * concern, and the storage bucket retains its own object metadata for the
 * who/when of the upload itself.
 */
export async function POST(req: Request) {
  const session = await authorizeRequest('client', 'clerk', 'admin')
  if (session instanceof Response) return session

  try {
    const body = RequestSchema.parse(await req.json())

    await withServiceRole(async (tx) => {
      await tx
        .update(profiles)
        .set({ avatarUrl: body.avatarUrl })
        .where(eq(profiles.userId, session.userId))
    })

    await bustUserSession(session.userId)
    return ok({ success: true, avatarUrl: body.avatarUrl })
  } catch (err) {
    console.error('[account/avatar] error:', err)
    return errorResponse(err)
  }
}
