import { and, desc, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { badRequest, errorResponse, ok } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import { db, notifications, withServiceRole } from '@/db'

export const maxDuration = 10
export const runtime = 'nodejs'

const PATCH_LIMIT = 100

const PatchSchema = z
  .object({
    /** `'all'` marks every unread row read. Otherwise must be a non-empty list. */
    ids: z.union([z.literal('all'), z.array(z.string().uuid()).min(1).max(PATCH_LIMIT)]),
  })
  .strict()

/**
 * GET /api/notifications — list the signed-in user's most recent
 * notifications (default 20). Used by the top-bar bell popover so every
 * role surface gets the same "open the bell, see your inbox" UX. The
 * popover is the primary consumer — full-page list at /admin/notifications
 * is admin-only and a different shape (broadcast / queue management).
 *
 * PATCH /api/notifications — mark notifications as read. Pass `{ids:'all'}`
 * to mark every unread row read (used when the popover opens) or
 * `{ids:[uuid,…]}` to mark specific ones (used when the user clicks a row).
 */
export async function GET(req: Request) {
  const session = await authorizeRequest()
  if (session instanceof Response) return session

  try {
    const url = new URL(req.url)
    const limit = Math.min(
      50,
      Math.max(1, Number.parseInt(url.searchParams.get('limit') ?? '20', 10) || 20)
    )

    const rows = await db
      .select({
        id: notifications.id,
        type: notifications.type,
        title: notifications.title,
        message: notifications.message,
        link: notifications.link,
        read: notifications.read,
        createdAt: notifications.createdAt,
      })
      .from(notifications)
      .where(eq(notifications.userId, session.userId))
      .orderBy(desc(notifications.createdAt))
      .limit(limit)

    return ok({ rows })
  } catch (err) {
    console.error('[api/notifications GET] error:', err)
    return errorResponse(err)
  }
}

export async function PATCH(req: Request) {
  const session = await authorizeRequest()
  if (session instanceof Response) return session

  try {
    const body = PatchSchema.parse(await req.json())
    let updated = 0
    if (body.ids === 'all') {
      const result = await withServiceRole(async (tx) =>
        tx
          .update(notifications)
          .set({ read: true })
          .where(
            and(
              eq(notifications.userId, session.userId),
              eq(notifications.read, false)
            )
          )
          .returning({ id: notifications.id })
      )
      updated = result.length
    } else {
      // Scope to the caller's own rows so a leaked id can't flip
      // someone else's notification.
      const result = await withServiceRole(async (tx) =>
        tx
          .update(notifications)
          .set({ read: true })
          .where(
            and(
              eq(notifications.userId, session.userId),
              inArray(notifications.id, body.ids as string[])
            )
          )
          .returning({ id: notifications.id })
      )
      updated = result.length
    }
    return ok({ updated })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return badRequest('Validation failed', err.flatten().fieldErrors)
    }
    console.error('[api/notifications PATCH] error:', err)
    return errorResponse(err)
  }
}

