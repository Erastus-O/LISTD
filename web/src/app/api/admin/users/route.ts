import { authorizeRequest } from '@/lib/dal'
import { errorResponse, ok, serverError } from '@/lib/api'
import { getSupabaseAdmin } from '@/lib/supabase/admin'

export const maxDuration = 30
export const runtime = 'nodejs'

/**
 * GET /api/admin/users — list Supabase auth users (id + email).
 *
 * Replaces supabase/functions/admin-list-users/index.ts.
 * Admin only. Service-role bypass is required because we read from
 * `auth.users`, which Drizzle can't reach (auth schema, not public).
 */
export async function GET() {
  const session = await authorizeRequest('admin')
  if (session instanceof Response) return session

  try {
    const admin = getSupabaseAdmin()
    const {
      data: { users },
      error,
    } = await admin.auth.admin.listUsers({ perPage: 1000 })

    if (error) throw error

    return ok({
      users: (users ?? []).map((u) => ({ id: u.id, email: u.email ?? null })),
    })
  } catch (err) {
    console.error('[admin/users] error:', err)
    return errorResponse(err)
  }
}
