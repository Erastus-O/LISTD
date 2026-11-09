import { and, eq, ilike, or } from 'drizzle-orm'
import { z } from 'zod'
import { errorResponse, ok } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import { db, profiles, userRoles } from '@/db'

export const maxDuration = 10
export const runtime = 'nodejs'

const QuerySchema = z.object({
  q: z.string().trim().min(2).max(80),
})

/**
 * GET /api/admin/billing/search-clients?q=… — admin-only typeahead used by
 * the manual-invoice form to pick the recipient. Limits to users that hold
 * the `client` role so the invoice always lands on someone with a client
 * surface to view it on.
 */
export async function GET(req: Request) {
  const session = await authorizeRequest('admin')
  if (session instanceof Response) return session

  try {
    const url = new URL(req.url)
    const parsed = QuerySchema.safeParse({ q: url.searchParams.get('q') ?? '' })
    if (!parsed.success) return ok({ results: [] })

    const like = `%${parsed.data.q}%`
    const rows = await db
      .select({
        userId: profiles.userId,
        fullName: profiles.fullName,
        companyName: profiles.companyName,
      })
      .from(profiles)
      .innerJoin(userRoles, eq(userRoles.userId, profiles.userId))
      .where(
        and(
          eq(userRoles.role, 'client'),
          or(
            ilike(profiles.fullName, like),
            ilike(profiles.companyName, like)
          )
        )
      )
      .limit(10)

    return ok({
      results: rows.map((r) => ({
        userId: r.userId,
        fullName: r.fullName ?? '(no name)',
        companyName: r.companyName,
      })),
    })
  } catch (err) {
    console.error('[admin/billing/search-clients] error:', err)
    return errorResponse(err)
  }
}
