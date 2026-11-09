import { and, eq } from 'drizzle-orm'
import { errorResponse, forbidden, notFound, ok } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import { organisationMembers, withServiceRole } from '@/db'
import { callerIp, callerUserAgent, logAuditEvent } from '@/lib/audit'

export const maxDuration = 10
export const runtime = 'nodejs'

type Params = Promise<{ userId: string }>

/**
 * POST /api/client/workers/[userId]/remove — owner revokes a worker's
 * access by flipping `organisation_members.status` to `'inactive'`.
 *
 * We keep the row (rather than hard-deleting) so the worker's historical
 * jobs still resolve their `created_by_user_id` link, and so the owner can
 * re-activate later without re-onboarding. The Supabase auth user is left
 * intact for the same reason — re-activation just flips status back.
 *
 * Audit: `account_status/worker.deactivated`.
 */
export async function POST(req: Request, { params }: { params: Params }) {
  const session = await authorizeRequest('client', 'admin')
  if (session instanceof Response) return session

  try {
    const { userId } = await params
    const ip = callerIp(req)
    const ua = callerUserAgent(req)

    // Owner check + lookup target's membership in one go: target must be a
    // worker in the same org the caller owns.
    const result = await withServiceRole(async (tx) => {
      const [callerMembership] = await tx
        .select({
          organisationId: organisationMembers.organisationId,
          orgRole: organisationMembers.orgRole,
        })
        .from(organisationMembers)
        .where(
          and(
            eq(organisationMembers.userId, session.userId),
            eq(organisationMembers.status, 'active')
          )
        )
        .limit(1)
      const isAdmin = session.roles.includes('admin')
      if (!callerMembership && !isAdmin) {
        return { status: 'forbidden' as const }
      }
      if (
        callerMembership &&
        callerMembership.orgRole !== 'owner' &&
        !isAdmin
      ) {
        return { status: 'forbidden' as const }
      }

      const [target] = await tx
        .select({
          id: organisationMembers.id,
          organisationId: organisationMembers.organisationId,
          orgRole: organisationMembers.orgRole,
          status: organisationMembers.status,
        })
        .from(organisationMembers)
        .where(eq(organisationMembers.userId, userId))
        .limit(1)
      if (!target) return { status: 'not_found' as const }
      if (
        callerMembership &&
        target.organisationId !== callerMembership.organisationId &&
        !isAdmin
      ) {
        return { status: 'forbidden' as const }
      }
      if (target.orgRole !== 'worker') {
        return { status: 'forbidden' as const }
      }
      if (target.status === 'inactive') {
        return { status: 'noop' as const }
      }

      await tx
        .update(organisationMembers)
        .set({ status: 'inactive' })
        .where(eq(organisationMembers.id, target.id))

      await logAuditEvent(tx, {
        category: 'account_status',
        action: 'worker.deactivated',
        actorUserId: session.userId,
        targetType: 'profile',
        targetId: userId,
        payload: {
          organisationId: target.organisationId,
          previousStatus: target.status,
        },
        ipAddress: ip,
        userAgent: ua,
      })

      return { status: 'ok' as const }
    })

    if (result.status === 'forbidden') return forbidden('Not allowed.')
    if (result.status === 'not_found') return notFound('Worker not found.')
    return ok({ success: true, noop: result.status === 'noop' })
  } catch (err) {
    console.error('[client/workers/remove] error:', err)
    return errorResponse(err)
  }
}

