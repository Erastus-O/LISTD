import { eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { errorResponse, notFound, ok } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import { notifications, profiles, withServiceRole } from '@/db'
import { callerIp, callerUserAgent, logAuditEvent } from '@/lib/audit'

export const maxDuration = 15
export const runtime = 'nodejs'

const STATUSES = ['active', 'suspended', 'deleted'] as const

const RequestSchema = z
  .object({
    status: z.enum(STATUSES),
    /** Required when transitioning to `suspended` or `deleted` — captured in
     *  the audit row and the in-app notification body. */
    reason: z.string().trim().max(500).optional(),
  })
  .strict()
  .refine(
    (b) => b.status === 'active' || (b.reason && b.reason.length > 0),
    {
      message: 'Reason is required when suspending or deleting',
      path: ['reason'],
    }
  )

type Params = Promise<{ clientId: string }>

/**
 * POST /api/admin/clients/[clientId]/account-status — admin transitions a
 * client account between `active` / `suspended` / `deleted` (real backing
 * for the previously-fake Status column in /admin/clients).
 *
 * Atomic in one tx:
 *   - Updates `profiles.account_status`. Stamps `deleted_at` on the
 *     `deleted` transition; clears it on a return to `active`.
 *   - Writes `account_status/account_status.changed` audit row with
 *     before/after + reason + actor.
 *   - Notifies the affected user in-app on suspend / reactivate (no
 *     notification on the soft-delete path — user is locked out anyway).
 *
 * `deleted` is **soft delete**: the row stays for 90-day audit retention.
 * Reactivating from `deleted` → `active` clears `deleted_at` and restores
 * access; the original soft-delete audit row remains for forensic trail.
 */
export async function POST(req: Request, { params }: { params: Params }) {
  const session = await authorizeRequest('admin')
  if (session instanceof Response) return session

  try {
    const { clientId } = await params
    const body = RequestSchema.parse(await req.json())
    const ip = callerIp(req)
    const ua = callerUserAgent(req)

    const result = await withServiceRole(async (tx) => {
      const [target] = await tx
        .select({
          userId: profiles.userId,
          fullName: profiles.fullName,
          accountStatus: profiles.accountStatus,
        })
        .from(profiles)
        .where(eq(profiles.userId, clientId))
        .limit(1)
      if (!target) return { status: 'not_found' as const }
      if (target.accountStatus === body.status) {
        return { status: 'noop' as const, current: target.accountStatus }
      }

      const isDeleting = body.status === 'deleted'
      const isReactivating =
        body.status === 'active' && target.accountStatus === 'deleted'

      await tx
        .update(profiles)
        .set({
          accountStatus: body.status,
          deletedAt: isDeleting
            ? sql`now()`
            : isReactivating
              ? null
              : undefined,
          updatedAt: sql`now()`,
        })
        .where(eq(profiles.userId, clientId))

      await logAuditEvent(tx, {
        category: 'account_status',
        action: 'account_status.changed',
        actorUserId: session.userId,
        targetType: 'profile',
        targetId: clientId,
        payload: {
          before: target.accountStatus,
          after: body.status,
          reason: body.reason ?? null,
        },
        ipAddress: ip,
        userAgent: ua,
      })

      // Notify the user on suspend / reactivate. Soft-delete intentionally
      // skips notification — the user is locked out and any in-app banner
      // would be invisible anyway.
      if (body.status === 'suspended') {
        await tx.insert(notifications).values({
          userId: clientId,
          type: 'system',
          title: 'Account suspended',
          message: body.reason
            ? `Your account has been suspended. Reason: ${body.reason}`
            : 'Your account has been suspended.',
          link: '/account',
        })
      } else if (isReactivating) {
        await tx.insert(notifications).values({
          userId: clientId,
          type: 'system',
          title: 'Account reactivated',
          message: 'Your account has been reactivated. Welcome back.',
          link: '/account',
        })
      }

      return { status: 'ok' as const }
    })

    if (result.status === 'not_found') return notFound('Client not found')
    return ok({
      success: true,
      noop: result.status === 'noop',
    })
  } catch (err) {
    console.error('[admin/clients/account-status] error:', err)
    return errorResponse(err)
  }
}
