import { eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { errorResponse, notFound, ok } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import { notifications, profiles, withServiceRole } from '@/db'
import { callerIp, callerUserAgent, logAuditEvent } from '@/lib/audit'

export const maxDuration = 15
export const runtime = 'nodejs'

const RequestSchema = z
  .object({
    /** Target level. Must be ≥1 and ≤3 (the supported badge tiers). */
    level: z.number().int().min(1).max(3),
    /** Optional admin rationale captured in the audit row + notification. */
    reason: z.string().trim().max(500).optional(),
  })
  .strict()

type Params = Promise<{ clerkId: string }>

/**
 * POST /api/admin/clerks/[clerkId]/level — admin promotes / demotes a
 * clerk's badge level. Backs the "Upgrade to Level X" button on the clerk
 * detail Badge Control card.
 *
 * Atomic in one tx:
 *   - Updates `profiles.clerk_level`.
 *   - Writes `verification/verification.level_changed` audit row with
 *     before/after + reason. (Reusing the `verification` audit category
 *     keeps level moves visible alongside approve / reject / suspend in the
 *     unified audit trail — they all describe the clerk's
 *     verification-tier state.)
 *   - Notifies the clerk in-app on a level promotion (skipped on demotion;
 *     demotions are typically punitive and admins prefer to communicate
 *     out-of-band).
 *
 * **Eligibility checks are advisory, not enforced** — the front-end shows
 * the criteria checklist and disables the button until they're met, but an
 * admin can override here if they have a reason. The audit row captures
 * the override.
 */
export async function POST(req: Request, { params }: { params: Params }) {
  const session = await authorizeRequest('admin')
  if (session instanceof Response) return session

  try {
    const { clerkId } = await params
    const body = RequestSchema.parse(await req.json())
    const ip = callerIp(req)
    const ua = callerUserAgent(req)

    const result = await withServiceRole(async (tx) => {
      const [target] = await tx
        .select({
          userId: profiles.userId,
          fullName: profiles.fullName,
          clerkLevel: profiles.clerkLevel,
        })
        .from(profiles)
        .where(eq(profiles.userId, clerkId))
        .limit(1)
      if (!target) return { status: 'not_found' as const }
      const before = target.clerkLevel ?? 1
      if (before === body.level) {
        return { status: 'noop' as const, current: before }
      }
      const isPromotion = body.level > before

      await tx
        .update(profiles)
        .set({
          clerkLevel: body.level,
          updatedAt: sql`now()`,
        })
        .where(eq(profiles.userId, clerkId))

      await logAuditEvent(tx, {
        category: 'verification',
        action: 'verification.level_changed',
        actorUserId: session.userId,
        targetType: 'profile',
        targetId: clerkId,
        payload: {
          before,
          after: body.level,
          direction: isPromotion ? 'promotion' : 'demotion',
          reason: body.reason ?? null,
        },
        ipAddress: ip,
        userAgent: ua,
      })

      if (isPromotion) {
        await tx.insert(notifications).values({
          userId: clerkId,
          type: 'system',
          title: `Promoted to Level ${body.level}`,
          message: body.reason
            ? `Congratulations : you've been promoted to Level ${body.level}. ${body.reason}`
            : `Congratulations : you've been promoted to Level ${body.level}.`,
          link: '/clerk/dashboard',
        })
      }

      return { status: 'ok' as const, before, after: body.level }
    })

    if (result.status === 'not_found') return notFound('Clerk not found')
    return ok({ success: true, noop: result.status === 'noop' })
  } catch (err) {
    console.error('[admin/clerks/level] error:', err)
    return errorResponse(err)
  }
}
