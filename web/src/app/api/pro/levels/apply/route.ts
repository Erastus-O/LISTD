import { z } from 'zod'
import { errorResponse, ok } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import { withServiceRole } from '@/db'
import { applyForLevel } from '@/lib/listd/pro-levels'
import { ProRoleSchema } from '@/lib/listd/schemas'

export const runtime = 'nodejs'

const Body = z.object({ role: ProRoleSchema, toLevel: z.number().int().min(2).max(3), note: z.string().trim().max(1000).optional() }).strict()

/** POST /api/pro/levels/apply: apply for the next level in a role. */
export async function POST(req: Request) {
  const session = await authorizeRequest('clerk', 'trades', 'cleaner')
  if (session instanceof Response) return session
  try {
    const body = Body.parse(await req.json())
    const r = await withServiceRole((tx) => applyForLevel(tx, session.userId, body.role, body.toLevel, body.note))
    if (!r.ok) return Response.json({ error: r.blockers[0], blockers: r.blockers }, { status: 409 })
    return ok({ success: true, id: r.id })
  } catch (err) {
    console.error('[pro/levels/apply] error:', err)
    return errorResponse(err)
  }
}
