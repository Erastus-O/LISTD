import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { errorResponse, ok } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import { proRoleLevels, withServiceRole } from '@/db'
import { logAuditEvent } from '@/lib/audit'
import { decideLevelApplication, setProLevel } from '@/lib/listd/pro-levels'
import { ProRoleSchema } from '@/lib/listd/schemas'

export const runtime = 'nodejs'

const Reason = z.string().trim().min(3, 'Give a reason').max(1000)
const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('set'), userId: z.string().uuid(), role: ProRoleSchema, level: z.number().int().min(1).max(3), reason: Reason }),
  z.object({ action: z.literal('decide'), applicationId: z.string().uuid(), approve: z.boolean(), reason: Reason }),
  z.object({ action: z.literal('pass_standards'), userId: z.string().uuid(), role: ProRoleSchema, reason: Reason }),
])

/**
 * POST /api/admin/pro-levels: set a level directly (e.g. an experienced Pro starts
 * higher), decide an application, or pass the standards check early. All audited.
 * Required training has no override.
 */
export async function POST(req: Request) {
  const session = await authorizeRequest('admin')
  if (session instanceof Response) return session
  try {
    const body = Body.parse(await req.json())
    const r = await withServiceRole(async (tx) => {
      if (body.action === 'set') {
        return setProLevel(tx, { userId: body.userId, role: body.role, level: body.level, actorId: session.userId, reason: body.reason })
      }
      if (body.action === 'decide') {
        return decideLevelApplication(tx, { id: body.applicationId, actorId: session.userId, approve: body.approve, reason: body.reason })
      }
      await tx
        .insert(proRoleLevels)
        .values({ userId: body.userId, role: body.role, standardsPassedAt: sql`now()`, standardsPassedBy: session.userId })
        .onConflictDoUpdate({
          target: [proRoleLevels.userId, proRoleLevels.role],
          set: { standardsPassedAt: sql`now()`, standardsPassedBy: session.userId, updatedAt: sql`now()` },
        })
      await logAuditEvent(tx, {
        category: 'verification',
        action: 'pro.standards_passed_early',
        actorUserId: session.userId,
        targetType: 'profile',
        targetId: body.userId,
        payload: { role: body.role, reason: body.reason },
      })
      return { ok: true as const }
    })
    if (!r.ok) return Response.json({ error: r.error }, { status: 409 })
    return ok({ success: true })
  } catch (err) {
    console.error('[admin/pro-levels] error:', err)
    return errorResponse(err)
  }
}
