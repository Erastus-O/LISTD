import 'server-only'
import { and, eq, sql } from 'drizzle-orm'
import { db, notifications } from '@/db'
import { cacheKey, getOrSet } from '@/lib/cache'

/**
 * Bell-badge count, cached at 30s. The bell sits in every role layout,
 * which means this loader runs on every server-rendered navigation —
 * dropping it from "DB hit per page" to "DB hit per 30s per user" is a
 * meaningful saving for chatty pages like the admin dashboard.
 *
 * 30s is the right TTL because:
 *   - A new notification appearing 30s late on the bell is invisible to
 *     users (you don't watch a bell badge for 30s straight).
 *   - It's short enough that we don't need to bust the cache from every
 *     notification-creation site — and every fan-out site would have to
 *     bust per-recipient, which is a lot of wiring for marginal benefit.
 *
 * For the "I just marked everything read and want the badge to reset
 * NOW" path, the popover updates `unreadCount` optimistically in client
 * state — the server cache catches up on the next 30s tick.
 */
const UNREAD_TTL_SECONDS = 30

/**
 * Unread in-app notification count for the signed-in user. Used by the
 * top-bar bell badge across every role layout. Capped display happens in
 * the UI (e.g. `9+`), not here — this returns the raw count so other
 * consumers can use it for analytics or per-page surfacing.
 */
export async function countUnreadNotifications(userId: string): Promise<number> {
  return getOrSet(
    cacheKey('notif', 'unread', userId),
    UNREAD_TTL_SECONDS,
    async () => {
      // `count(*)` server-side is cheaper than pulling row IDs back over
      // the wire and `.length`-ing them — saves the row-fetch round trip
      // on users with hundreds of unread rows.
      const [row] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(notifications)
        .where(
          and(eq(notifications.userId, userId), eq(notifications.read, false))
        )
      return row?.count ?? 0
    }
  )
}
