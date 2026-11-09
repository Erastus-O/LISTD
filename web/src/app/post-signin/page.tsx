import { redirect } from 'next/navigation'
import { getSession } from '@/lib/dal'
import { bootstrapUser } from '@/lib/onboarding'
import { createClient } from '@/lib/supabase/server'

type Props = {
  searchParams: Promise<{ redirect?: string }>
}

/**
 * Server-side router for post-sign-in (and post-sign-up) navigation.
 *
 * Reads the session + profile + roles via the DAL and redirects to the right
 * landing page. Centralises what used to be a tangled `useEffect` chain on
 * the client side in the Lovable repo's `Auth.tsx`.
 *
 * **Bootstrap fallback:** runs when EITHER the `profiles` row is missing OR
 * the `user_roles` list is empty. The legacy [`handle_new_user`](
 * ../../../../supabase/migrations/20260128093242_7a1cec66-c8ef-4dc1-ab5b-b975210c6533.sql)
 * Postgres trigger creates a profiles row on `auth.users` insert but does
 * not create a user_roles row, so a profile-presence-only check leaves the
 * user role-less and misrouted as a default client. Bootstrap sources
 * `full_name` + `role` from `auth.users.user_metadata` (set by
 * [auth-form.tsx](../auth/auth-form.tsx) at signup time) and calls
 * [`bootstrapUser`](../../lib/onboarding.ts) directly. Replaces the old
 * client-side `/api/onboarding/init` fetch, which 401'd whenever email
 * confirmation was on.
 */
export default async function PostSignin({ searchParams }: Props) {
  const sp = await searchParams
  const session = await getSession()
  if (!session) redirect('/auth')

  if (!session.profile || session.roles.length === 0) {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    const fullName =
      typeof user?.user_metadata?.full_name === 'string'
        ? user.user_metadata.full_name
        : ''
    const rawRole = user?.user_metadata?.role
    const privacyPolicyVersion =
      typeof user?.user_metadata?.privacy_policy_version === 'string'
        ? user.user_metadata.privacy_policy_version
        : null
    const privacyConsentAt =
      typeof user?.user_metadata?.privacy_consent_at === 'string'
        ? user.user_metadata.privacy_consent_at
        : null
    if (rawRole !== 'client' && rawRole !== 'clerk' && rawRole !== 'cleaner' && rawRole !== 'trades') {
      // No usable role in user_metadata. Don't fabricate one — bounce to
      // /onboarding which renders a role-picker fallback.
      if (!session.profile && fullName) {
        // We can still backfill the profile row even without a role, so the
        // /onboarding page has a name to greet with.
        await bootstrapProfileOnly(session.userId, fullName)
      }
      redirect('/onboarding')
    }
    await bootstrapUser({
      userId: session.userId,
      fullName,
      role: rawRole,
      privacyPolicyVersion,
      privacyConsentAt,
    })
    // Re-render through this page so `getSession` (React-cached per render)
    // sees the freshly-inserted profile + role rows.
    redirect(
      sp.redirect
        ? `/post-signin?redirect=${encodeURIComponent(sp.redirect)}`
        : '/post-signin'
    )
  }

  // Honour explicit ?redirect= parameter when supplied (e.g. deep-link returns).
  if (sp.redirect) redirect(sp.redirect)

  // Worker invite flow: the temp password forces a reset before anything
  // else. We send the user straight to the reset page so they don't briefly
  // see (and then get bounced from) a dashboard.
  if (session.profile.passwordMustChange) {
    redirect('/account/password/reset?force=1')
  }

  if (!session.profile.onboardingCompleted) {
    redirect('/onboarding')
  }

  if (session.roles.includes('admin')) redirect('/admin/dashboard')
  // Restricted SEO-agency seat — their only surface is the meta editor.
  if (session.roles.includes('marketing')) redirect('/admin/seo')
  if (session.roles.includes('clerk') || session.roles.includes('trades')) redirect('/clerk/dashboard')
  if (session.roles.includes('cleaner')) redirect('/cleaner/dashboard')

  // Client surface split: org workers (org_role='worker') get their own
  // /worker/* dashboard; owners + solo clients land on /client.
  if (session.roles.includes('client')) {
    const { loadCallerMembership } = await import(
      '@/lib/dashboard/client-workers'
    )
    const membership = await loadCallerMembership(session.userId)
    if (membership?.orgRole === 'worker') redirect('/worker/dashboard')
  }
  redirect('/client/dashboard')
}

/**
 * Profile-only bootstrap for the corner case where `user_metadata.role`
 * isn't recognised. Lets us fill in `full_name` so the `/onboarding`
 * role-picker page can greet the user. Imported lazily so the dominant
 * (role-known) path doesn't pay the import cost.
 */
async function bootstrapProfileOnly(userId: string, fullName: string) {
  const { eq } = await import('drizzle-orm')
  const { profiles, withServiceRole } = await import('@/db')
  await withServiceRole(async (tx) => {
    const existing = await tx
      .select({ id: profiles.id })
      .from(profiles)
      .where(eq(profiles.userId, userId))
      .limit(1)
    if (existing.length === 0) {
      await tx.insert(profiles).values({ userId, fullName, onboardingCompleted: false })
    }
  })
}
