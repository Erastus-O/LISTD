import 'server-only'
import { cache } from 'react'
import { redirect } from 'next/navigation'
import { and, eq, sql } from 'drizzle-orm'
import { db } from '@/db'
import {
  organisationMembers,
  profiles,
  userRoles,
  type appRole,
} from '@/db/schema/schema'
import { bust, cacheKey, getOrSet } from '@/lib/cache'
import { createClient } from '@/lib/supabase/server'

export type AppRole = (typeof appRole.enumValues)[number]

export type Session = {
  userId: string
  email: string | null
  profile: typeof profiles.$inferSelect | null
  roles: AppRole[]
}

/**
 * Cross-request cache for the per-user (profile, roles) blob. The Supabase
 * auth check still runs on every call (we need to identify the user before
 * looking anything up), but the two DB roundtrips for `profiles` +
 * `user_roles` are the actual cost — those get cached.
 *
 * TTL is 60 seconds, which is the staleness window for role changes. If an
 * admin revokes a user's role, that user can still hit role-gated pages
 * for up to 60s. Acceptable for normal operation; if you need instant
 * lock-out (e.g. a security incident) bust the affected user with
 * `bustUserSession(userId)` from the revoke route, or scrub Redis from
 * the Upstash console.
 */
const SESSION_TTL_SECONDS = 60

type SessionLookup = {
  profile: typeof profiles.$inferSelect | null
  roles: AppRole[]
}

async function loadUserProfileAndRoles(userId: string): Promise<SessionLookup> {
  return getOrSet(
    cacheKey('session', userId),
    SESSION_TTL_SECONDS,
    async () => {
      const [profile, roleRows] = await Promise.all([
        db.query.profiles.findFirst({ where: eq(profiles.userId, userId) }),
        db
          .select({ role: userRoles.role })
          .from(userRoles)
          .where(eq(userRoles.userId, userId)),
      ])
      return {
        profile: profile ?? null,
        roles: roleRows.map((r) => r.role),
      }
    }
  )
}

/**
 * Bust the cached profile+roles for a user. Call from any route that
 * writes to `profiles` (avatar upload, profile edit) or `user_roles`
 * (admin role grant/revoke) so the next page render reflects the change
 * without waiting out the 60s TTL.
 */
export async function bustUserSession(userId: string): Promise<void> {
  return bust(cacheKey('session', userId))
}

/**
 * Load the current session. Returns null if unauthenticated.
 * Memoized per render pass via React `cache()` — multiple callers in the same
 * request share one DB hit. Cross-request, the inner profile+roles lookup is
 * cached in Redis (see {@link loadUserProfileAndRoles}).
 */
export const getSession = cache(async (): Promise<Session | null> => {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return null

  const { profile, roles } = await loadUserProfileAndRoles(user.id)

  // Best-effort: stamp `organisation_members.last_active_at` for every
  // active membership the user holds. Throttled to one write per user per
  // minute so we don't hammer Postgres on every page render. This is the
  // canonical writer that backs the "Last Active" column on /admin/clients.
  void touchOrgActivity(user.id)

  return {
    userId: user.id,
    email: user.email ?? null,
    profile,
    roles,
  }
})

/**
 * In-memory per-user throttle for `last_active_at` updates. Single-instance
 * deployments converge to one write per user per minute; multi-instance
 * deployments allow one write per instance per user per minute (acceptable —
 * the column is for "freshness" signalling, not exact-second accuracy).
 */
const ACTIVITY_TOUCH_WINDOW_MS = 60_000
const lastActivityTouch = new Map<string, number>()

async function touchOrgActivity(userId: string): Promise<void> {
  const now = Date.now()
  const previous = lastActivityTouch.get(userId)
  if (previous && now - previous < ACTIVITY_TOUCH_WINDOW_MS) return
  lastActivityTouch.set(userId, now)
  try {
    await db
      .update(organisationMembers)
      .set({ lastActiveAt: sql`now()` })
      .where(
        and(
          eq(organisationMembers.userId, userId),
          eq(organisationMembers.status, 'active')
        )
      )
  } catch (err) {
    // Non-fatal — the auth session is what matters; activity tracking is a
    // freshness signal for admins and shouldn't 500 a page render.
    console.warn('[dal] failed to touch org activity:', err)
    // Reset the throttle so the next request retries.
    lastActivityTouch.delete(userId)
  }
}

/**
 * Require an authenticated session. Redirects to /login if not authenticated.
 * Use in Server Components and Route Handlers that must not run anonymously.
 *
 * Also enforces the `profiles.password_must_change` gate: if the user was
 * created with a temp password (worker invite flow), every page render is
 * redirected to `/account/password/reset` until they set a new password.
 * The reset page itself bypasses this guard by calling `getSession()`
 * directly (see `app/account/password/reset/page.tsx`).
 */
export const requireSession = cache(async (): Promise<Session> => {
  const session = await getSession()
  if (!session) redirect('/login')
  if (session.profile?.passwordMustChange) {
    redirect('/account/password/reset?force=1')
  }
  return session
})

/**
 * Require a session with at least one of the given roles.
 * Returns 403-style behaviour by redirecting to /unauthorized.
 */
export const requireRole = cache(
  async (...allowed: AppRole[]): Promise<Session> => {
    const session = await requireSession()
    if (!session.roles.some((r) => allowed.includes(r))) {
      redirect('/unauthorized')
    }
    return session
  }
)

/**
 * Route Handler variant: returns Response objects on auth failure instead of
 * redirecting. Use inside `app/api/.../route.ts` files.
 */
export async function authorizeRequest(
  ...allowed: AppRole[]
): Promise<Session | Response> {
  const session = await getSession()
  if (!session) {
    return new Response(null, { status: 401 })
  }
  if (allowed.length > 0 && !session.roles.some((r) => allowed.includes(r))) {
    return new Response(null, { status: 403 })
  }
  return session
}
