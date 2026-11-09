import { and, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { errorResponse, forbidden, ok } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import { organisationMembers, organisations, withServiceRole } from '@/db'

export const runtime = 'nodejs'

const Schema = z.object({
  mode: z.enum(['owner_link', 'worker_pays']),
})

/**
 * POST /api/client/org/payment-mode — owner sets how their workers' posts are
 * paid for. 'owner_link' (default): a Stripe payment link is sent to the
 * owner to publish each worker post. 'worker_pays': the worker pays at
 * checkout. Owner-only (admins may also set it).
 */
export async function POST(req: Request) {
  const session = await authorizeRequest('client', 'admin')
  if (session instanceof Response) return session

  try {
    const { mode } = Schema.parse(await req.json())
    const isAdmin = session.roles.includes('admin')

    const updatedMode = await withServiceRole(async (tx) => {
      const [membership] = await tx
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
      if (!membership) return null
      if (membership.orgRole !== 'owner' && !isAdmin) return null

      await tx
        .update(organisations)
        .set({ workerPostPaymentMode: mode, updatedAt: sql`now()` })
        .where(eq(organisations.id, membership.organisationId))
      return mode
    })

    if (!updatedMode) {
      return forbidden('Only the organisation owner can change this setting.')
    }
    return ok({ success: true, mode: updatedMode })
  } catch (err) {
    return errorResponse(err)
  }
}
