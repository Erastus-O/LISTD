import { and, eq } from 'drizzle-orm'
import { errorResponse, forbidden, notFound, ok } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import { organisationMembers, withServiceRole } from '@/db'
import { callerIp, callerUserAgent, logAuditEvent } from '@/lib/audit'

export const maxDuration = 10
export const runtime = 'nodejs'

type Params = Promise<{ userId: string }>

/**
 * POST /api/client/workers/[userId]/reactivate — owner re-enables a
 * previously removed worker by flipping `organisation_members.status`
 * back to `'active'`.
 *
 * Audit: `account_status/worker.reactivated`.
 *
 * The Supabase auth user was never deleted on remove (see
 * `[userId]/remove/route.ts`), so the worker can immediately log back in
 * with their existing password. If they forgot it, they use the standard
 * password-reset flow.
 */
export async function POST(req: Request, { params }: { params: Params }) {
  const session = await authorizeRequest('client', 'admin')
  if (session instanceof Response) return session

  try {
    const { userId } = await params
    const ip = callerIp(req)
    const ua = callerUserAgent(req)

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
      if (target.status === 'active') {
        return { status: 'noop' as const }
      }

      await tx
        .update(organisationMembers)
        .set({ status: 'active' })
        .where(eq(organisationMembers.id, target.id))

      await logAuditEvent(tx, {
        category: 'account_status',
        action: 'worker.reactivated',
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
    console.error('[client/workers/reactivate] error:', err)
    return errorResponse(err)
  }
}
