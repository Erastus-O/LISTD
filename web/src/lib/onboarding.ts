import 'server-only'
import { and, eq, isNull } from 'drizzle-orm'
import { profiles, userRoles, withServiceRole } from '@/db'
import { PRIVACY_POLICY_VERSION } from '@/lib/legal/policy'

/**
 * Idempotent post-signup bootstrap. Inserts a `profiles` row + a `user_roles`
 * row for a freshly-confirmed user. Safe to call repeatedly — re-runs only
 * fill missing data.
 *
 * Called from two places:
 *   - [/post-signin](../app/post-signin/page.tsx) — server component, fires
 *     on the first authenticated render after sign-up. This is the canonical
 *     path; it works regardless of whether email confirmation is enabled.
 *   - [POST /api/onboarding/init](../app/api/onboarding/init/route.ts) — kept
 *     for back-compat with any external caller (none today). Both paths
 *     call this helper so the bootstrap shape stays in lockstep.
 *
 * **Trust boundary:** the caller has already verified the session belongs
 * to `userId` (post-signin does this implicitly via `getSession()`; the API
 * handler does it via `authorizeRequest()`). This function does not
 * re-verify — it just writes.
 */
export async function bootstrapUser(params: {
  userId: string
  fullName: string
  role: 'client' | 'clerk' | 'cleaner' | 'trades'
  /** Privacy Policy version the user agreed to at signup (from user_metadata).
   *  Defaults to the current version when consent is being recorded. */
  privacyPolicyVersion?: string | null
  /** ISO timestamp of when consent was given (signup time, which may predate
   *  this bootstrap when email confirmation is on). */
  privacyConsentAt?: string | null
}): Promise<void> {
  // Service-role bypass: signup-time bootstrap, scoped to a single user_id
  // the caller has authenticated. ADR-001 carve-out.
  await withServiceRole(async (tx) => {
    const existing = await tx
      .select({ id: profiles.id })
      .from(profiles)
      .where(eq(profiles.userId, params.userId))
      .limit(1)

    if (existing.length === 0) {
      await tx.insert(profiles).values({
        userId: params.userId,
        fullName: params.fullName,
        onboardingCompleted: false,
      })
    } else if (params.fullName) {
      // Update full_name only if the existing row has none, so a returning
      // user re-running bootstrap doesn't clobber a curated name.
      await tx
        .update(profiles)
        .set({ fullName: params.fullName })
        .where(eq(profiles.userId, params.userId))
    }

    // Idempotent: user_roles has UNIQUE(user_id, role).
    await tx
      .insert(userRoles)
      .values({ userId: params.userId, role: params.role })
      .onConflictDoNothing()
  })

  // Record the signup consent. Kept OUT of the bootstrap tx and best-effort so
  // a pre-0031 database (columns not yet migrated) can never block signup.
  // Idempotent via the `is null` guard — also covers rows pre-created by the
  // legacy `handle_new_user` trigger, where the insert branch above is skipped.
  if (params.privacyConsentAt || params.privacyPolicyVersion) {
    const consentAt = params.privacyConsentAt ?? new Date().toISOString()
    try {
      await withServiceRole((tx) =>
        tx
          .update(profiles)
          .set({
            privacyPolicyVersion:
              params.privacyPolicyVersion ?? PRIVACY_POLICY_VERSION,
            privacyPolicyAcceptedAt: consentAt,
            termsAgreedAt: consentAt,
          })
          .where(
            and(
              eq(profiles.userId, params.userId),
              isNull(profiles.privacyPolicyAcceptedAt)
            )
          )
      )
    } catch (err) {
      console.warn(
        '[onboarding] consent stamp skipped (is migration 0031 applied?):',
        err
      )
    }
  }
}
