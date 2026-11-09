import { z } from 'zod'
import { errorResponse, ok } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import { bootstrapUser } from '@/lib/onboarding'

export const maxDuration = 15
export const runtime = 'nodejs'

const RequestSchema = z.object({
  // userId is informational only — the server uses session.userId regardless.
  userId: z.string().uuid().optional(),
  fullName: z.string().trim().min(1).max(100),
  role: z.enum(['client', 'clerk']),
})

/**
 * POST /api/onboarding/init — bootstrap a freshly-signed-up user with their
 * profile row and primary role.
 *
 * **Status:** retained for back-compat. The canonical bootstrap path is now
 * server-side in [`/post-signin`](../../../post-signin/page.tsx) which reads
 * `user_metadata.full_name` and `user_metadata.role` from the verified
 * session and calls [`bootstrapUser`](../../../../lib/onboarding.ts) directly.
 *
 * The previous client-side call from [auth-form.tsx](../../../auth/auth-form.tsx)
 * has been removed because (a) it 401'd whenever Supabase email confirmation
 * was enabled (no session yet at signUp time) and (b) it raced the
 * supabase-ssr cookie sync even with email confirmation disabled.
 */
export async function POST(req: Request) {
  const session = await authorizeRequest()
  if (session instanceof Response) return session

  try {
    const { fullName, role } = RequestSchema.parse(await req.json())
    await bootstrapUser({ userId: session.userId, fullName, role })
    return ok({ success: true })
  } catch (err) {
    return errorResponse(err)
  }
}
