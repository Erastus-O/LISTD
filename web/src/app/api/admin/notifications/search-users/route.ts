import { ilike } from 'drizzle-orm'
import { z } from 'zod'
import { errorResponse, ok } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import { db, profiles } from '@/db'

export const maxDuration = 10
export const runtime = 'nodejs'

const QuerySchema = z.object({
  q: z.string().trim().min(2).max(80),
})

/**
 * GET /api/admin/notifications/search-users?q=… — admin-only typeahead for
 * picking an individual recipient in the Send Manual flow.
 *
 * Returns up to 10 matches by `full_name`. Doesn't expose email or other
 * PII beyond the name — the broadcast handler resolves the real user id
 * anyway, so the typeahead only needs enough to disambiguate.
 */
export async function GET(req: Request) {
  const session = await authorizeRequest('admin')
  if (session instanceof Response) return session

  try {
    const url = new URL(req.url)
    const parsed = QuerySchema.safeParse({ q: url.searchParams.get('q') ?? '' })
    if (!parsed.success) {
      return ok({ results: [] })
    }
    const like = `%${parsed.data.q}%`
    const rows = await db
      .select({
        userId: profiles.userId,
        fullName: profiles.fullName,
      })
      .from(profiles)
      .where(ilike(profiles.fullName, like))
      .limit(10)
    return ok({
      results: rows.map((r) => ({
        userId: r.userId,
        fullName: r.fullName ?? '(no name)',
      })),
    })
  } catch (err) {
    console.error('[admin/notifications/search-users] error:', err)
    return errorResponse(err)
  }
}
