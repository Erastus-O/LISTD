import { z } from 'zod'
import { errorResponse, ok } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import { withServiceRole } from '@/db'
import { callerIp, callerUserAgent, logAuditEvent } from '@/lib/audit'

export const maxDuration = 10
export const runtime = 'nodejs'

const RequestSchema = z.object({
  targetUserId: z.string().uuid(),
  /**
   * ISO timestamp the SPA recorded when impersonation started. Optional —
   * if absent, duration is logged as null. Trusted only for the audit
   * payload (UX provenance), not for any auth decision.
   */
  startedAt: z.string().datetime().optional(),
})

/**
 * POST /api/admin/impersonation/end — counterpart to `…/start`. Logs the
 * end of an admin impersonation session and (when the SPA passes
 * `startedAt`) the duration. Closes the M1 #22 F2 forensic gap by
 * guaranteeing a paired start/end record per impersonation.
 */
export async function POST(req: Request) {
  const session = await authorizeRequest('admin')
  if (session instanceof Response) return session

  try {
    const { targetUserId, startedAt } = RequestSchema.parse(await req.json())

    const durationSeconds = startedAt
      ? Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000))
      : null

    const ip = callerIp(req)
    const ua = callerUserAgent(req)

    await withServiceRole((tx) =>
      logAuditEvent(tx, {
        category: 'impersonation',
        action: 'impersonation.end',
        actorUserId: session.userId,
        targetType: 'profile',
        targetId: targetUserId,
        payload: {
          durationSeconds,
          startedAt: startedAt ?? null,
        },
        ipAddress: ip,
        userAgent: ua,
      })
    )

    return ok({ success: true, durationSeconds })
  } catch (err) {
    return errorResponse(err)
  }
}
