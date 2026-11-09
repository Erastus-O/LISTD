import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { badRequest, errorResponse, ok, unauthorized } from '@/lib/api'
import { profiles, withServiceRole } from '@/db'
import { rateLimitOrResponse } from '@/lib/rate-limit'
import { createClient } from '@/lib/supabase/server'

export const maxDuration = 15
export const runtime = 'nodejs'

const RequestSchema = z
  .object({
    newPassword: z.string().min(8).max(200),
  })
  .strict()

/**
 * POST /api/account/password — authenticated user updates their own
 * password. Available to every role (client / clerk / admin) because the
 * action is keyed on the caller's session — there's no target user.
 *
 * Uses the cookie-bound Supabase server client so `auth.updateUser` runs
 * as the calling user. We deliberately don't proxy through the admin
 * service-role key — a self-service password change shouldn't need
 * privilege elevation, and routing through admin would let the handler
 * change anyone's password if the caller-id check ever drifted.
 *
 * No audit row — the password value is intentionally never observable
 * after the change, and Supabase auth keeps its own change history.
 * If compliance later asks for a "user changed password at T" trail, add
 * an `account_status/password.changed` audit row in a follow-up.
 */
export async function POST(req: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return unauthorized()

    // Rate-limit by userId rather than IP — this endpoint is authenticated,
    // so the user is the natural cost unit. Protects against a hijacked
    // session being used to enumerate password rules / weak-password lists.
    // 5 per 10 min: enough headroom for an honest user retrying after a
    // password-strength rejection.
    const limited = await rateLimitOrResponse({
      scope: 'account-password-change',
      identifier: user.id,
      limit: 5,
      windowSeconds: 10 * 60,
    })
    if (limited) return limited

    const body = RequestSchema.parse(await req.json())

    const { error } = await supabase.auth.updateUser({
      password: body.newPassword,
    })
    if (error) {
      // `weak_password` etc. — surface the message to help the user.
      return badRequest(error.message)
    }

    // Clear the forced-reset flag set during worker invite (migration 0010).
    // Best-effort — the password change has already succeeded by the time
    // we reach here, so a flag-update failure shouldn't 500 the caller.
    try {
      await withServiceRole(async (tx) => {
        await tx
          .update(profiles)
          .set({ passwordMustChange: false })
          .where(eq(profiles.userId, user.id))
      })
    } catch (err) {
      console.warn('[account/password] failed to clear must-change flag:', err)
    }

    return ok({ success: true })
  } catch (err) {
    console.error('[account/password] error:', err)
    return errorResponse(err)
  }
}
