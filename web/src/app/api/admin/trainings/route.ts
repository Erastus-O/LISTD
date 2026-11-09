import { eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { errorResponse, ok } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import { trainings, withServiceRole } from '@/db'
import { logAuditEvent } from '@/lib/audit'
import { ProRoleSchema } from '@/lib/listd/schemas'

export const runtime = 'nodejs'

const Fields = z.object({
  title: z.string().trim().min(2).max(200),
  description: z.string().trim().max(2000).optional(),
  kind: z.enum(['video', 'pdf', 'link']),
  url: z.string().url().startsWith('https://'),
  role: ProRoleSchema.nullable().optional(),
  level: z.number().int().min(0).max(3),
  minutes: z.number().int().min(0).optional(),
  status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']),
})
const Body = Fields.extend({ id: z.string().uuid().optional() })

/** POST /api/admin/trainings: create or update a training. */
export async function POST(req: Request) {
  const session = await authorizeRequest('admin')
  if (session instanceof Response) return session
  try {
    const { id, ...fields } = Body.parse(await req.json())
    const row = await withServiceRole(async (tx) => {
      const [r] = id
        ? await tx.update(trainings).set({ ...fields, updatedAt: sql`now()` }).where(eq(trainings.id, id)).returning({ id: trainings.id })
        : await tx.insert(trainings).values({ ...fields, createdBy: session.userId }).returning({ id: trainings.id })
      if (r) {
        await logAuditEvent(tx, {
          category: 'platform_setting',
          action: id ? 'training.updated' : 'training.created',
          actorUserId: session.userId,
          targetType: 'training',
          targetId: r.id,
          payload: { title: fields.title, status: fields.status },
        })
      }
      return r
    })
    if (!row) return Response.json({ error: 'Training not found' }, { status: 404 })
    return ok({ success: true, id: row.id })
  } catch (err) {
    console.error('[admin/trainings] error:', err)
    return errorResponse(err)
  }
}
