import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import {
  badRequest,
  errorResponse,
  notFound,
  ok,
} from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import {
  clerkInvitations,
  userRoles,
  withServiceRole,
} from '@/db'
import { rateLimitOrResponse } from '@/lib/rate-limit'

export const maxDuration = 15
export const runtime = 'nodejs'

const RequestSchema = z.object({ token: z.string().uuid() })

/**
 * POST /api/invitations/clerk/accept — accept a clerk invitation.
 *
 * Authenticated. Marks the invitation accepted, grants the caller the `clerk`
 * role, and (idempotent on `user_roles`) returns the inviting provider id so
 * the client can fire `notify-invitation-accepted`.
 */
export async function POST(req: Request) {
  const session = await authorizeRequest()
  if (session instanceof Response) return session

  // The invitation token is a UUID, so brute-forcing one is computationally
  // infeasible (~2^128 search space). This rate limit is defense-in-depth:
  // 10 per hour per user makes a token-spraying attack from a compromised
  // session expensive enough to be noticeable in logs without blocking a
  // legitimate user from retrying after a typo.
  const limited = await rateLimitOrResponse({
    scope: 'invitation-clerk-accept',
    identifier: session.userId,
    limit: 10,
    windowSeconds: 60 * 60,
  })
  if (limited) return limited

  try {
    const { token } = RequestSchema.parse(await req.json())

    const result = await withServiceRole(async (tx) => {
      const [invite] = await tx
        .select()
        .from(clerkInvitations)
        .where(eq(clerkInvitations.token, token))
        .limit(1)

      if (!invite) return { error: 'not_found' as const }
      if (invite.status === 'accepted')
        return { error: 'already_accepted' as const }
      if (new Date(invite.expiresAt) < new Date())
        return { error: 'expired' as const }

      await tx
        .update(clerkInvitations)
        .set({ status: 'accepted', acceptedAt: new Date().toISOString() })
        .where(
          and(
            eq(clerkInvitations.token, token),
            eq(clerkInvitations.status, 'pending')
          )
        )

      await tx
        .insert(userRoles)
        .values({ userId: session.userId, role: 'clerk' })
        .onConflictDoNothing()

      return { providerId: invite.providerId, email: invite.email }
    })

    if ('error' in result) {
      if (result.error === 'not_found')
        return notFound('Invitation not found')
      if (result.error === 'expired')
        return badRequest('Invitation has expired')
      if (result.error === 'already_accepted')
        return badRequest('Invitation already accepted')
    }

    return ok({ success: true, providerId: result.providerId })
  } catch (err) {
    return errorResponse(err)
  }
}
