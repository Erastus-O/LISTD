import { eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { errorResponse, notFound, ok } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import { profiles, withServiceRole } from '@/db'

export const maxDuration = 15
export const runtime = 'nodejs'

const RequestSchema = z
  .object({
    notes: z.string().max(10_000),
  })
  .strict()

type Params = Promise<{ userId: string }>

/**
 * POST /api/admin/profiles/[userId]/admin-notes — admin saves the internal
 * notes scratchpad on a profile (visible from /admin/clients/[id] and
 * /admin/clerks/[id]). Backed by `profiles.admin_notes` (migration 0007).
 *
 * **No audit row** — admin notes are free-form internal context, not a
 * state transition. If a compliance reviewer later asks for diff history,
 * we can add a `profile_metadata` audit category in a follow-up.
 */
export async function POST(req: Request, { params }: { params: Params }) {
  const session = await authorizeRequest('admin')
  if (session instanceof Response) return session

  try {
    const { userId } = await params
    const body = RequestSchema.parse(await req.json())

    const result = await withServiceRole(async (tx) => {
      const updated = await tx
        .update(profiles)
        .set({
          adminNotes: body.notes.trim() || null,
          updatedAt: sql`now()`,
        })
        .where(eq(profiles.userId, userId))
        .returning({ userId: profiles.userId })
      if (updated.length === 0) return { status: 'not_found' as const }
      return { status: 'ok' as const }
    })

    if (result.status === 'not_found') return notFound('Profile not found')
    return ok({ success: true })
  } catch (err) {
    console.error('[admin/profiles/admin-notes] error:', err)
    return errorResponse(err)
  }
}
