import { eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { errorResponse, notFound, ok } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import { profiles, userRoles, withServiceRole } from '@/db'
import { callerIp, callerUserAgent, logAuditEvent } from '@/lib/audit'

export const maxDuration = 15
export const runtime = 'nodejs'

const RequestSchema = z.object({
  targetUserId: z.string().uuid(),
})

/**
 * POST /api/admin/impersonation/start — log the start of an admin "act as"
 * session against the canonical audit trail (M1 #22 Package B / F2 closure).
 *
 * **Important:** this handler does NOT issue any auth token for the target
 * user. The Lovable SPA pattern of `sessionStorage.setItem("impersonating",
 * …)` to relabel the UI client-side is preserved verbatim — the admin's own
 * Supabase session remains in force. The only thing this endpoint adds is
 * the **forensic record**: who impersonated whom, from which IP, when.
 *
 * That gives compliance a fully-recoverable history of admin "act as"
 * activity, which previously had **zero** server-side trace (M1 #22 F2).
 *
 * Request body: `{ targetUserId: uuid }`.
 *
 * Returns the target's profile name and roles so the SPA can render the
 * impersonation badge with current data without a second round-trip.
 */
export async function POST(req: Request) {
  const session = await authorizeRequest('admin')
  if (session instanceof Response) return session

  try {
    const { targetUserId } = RequestSchema.parse(await req.json())

    if (targetUserId === session.userId) {
      return Response.json(
        { error: 'Cannot impersonate yourself.' },
        { status: 400 }
      )
    }

    const ip = callerIp(req)
    const ua = callerUserAgent(req)

    const target = await withServiceRole(async (tx) => {
      const [profile] = await tx
        .select({
          userId: profiles.userId,
          fullName: profiles.fullName,
        })
        .from(profiles)
        .where(eq(profiles.userId, targetUserId))
        .limit(1)
      if (!profile) return null

      const roles = await tx
        .select({ role: userRoles.role })
        .from(userRoles)
        .where(inArray(userRoles.userId, [targetUserId]))

      // Audit row inside the same tx — never end up with a "started
      // impersonating" UI state but no log row.
      await logAuditEvent(tx, {
        category: 'impersonation',
        action: 'impersonation.start',
        actorUserId: session.userId,
        targetType: 'profile',
        targetId: targetUserId,
        payload: {
          targetName: profile.fullName ?? null,
          targetRoles: roles.map((r) => r.role),
        },
        ipAddress: ip,
        userAgent: ua,
      })

      return {
        userId: profile.userId,
        fullName: profile.fullName,
        roles: roles.map((r) => r.role),
      }
    })

    if (!target) return notFound('Target user not found.')

    return ok({ success: true, target })
  } catch (err) {
    return errorResponse(err)
  }
}
