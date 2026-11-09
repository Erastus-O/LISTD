import { redirect } from 'next/navigation'
import { requireSession } from '@/lib/dal'
import { ClientOnboarding } from './client-onboarding'

export const metadata = { title: 'Client onboarding' }

/**
 * 3-step client onboarding (PRD §5.1 / M1 #1–4):
 *   1. Personal Details      → /api/onboarding/client/personal
 *   2. Organisation Setup    → /api/onboarding/client/organisation
 *   3. Terms of Business     → /api/onboarding/client/terms
 *
 * On completion `terms_of_business_signed_at` and `onboarding_completed` flip,
 * unblocking job posting at `/book`.
 */
export default async function ClientOnboardingPage() {
  const session = await requireSession()

  // Anyone non-client routes back to the generic landing onboarding shell,
  // which dispatches by role.
  if (
    !session.roles.includes('client') &&
    !session.roles.includes('admin') &&
    session.roles.length > 0
  ) {
    redirect('/onboarding')
  }

  // If they've already completed Step 3 (Terms signed), there's nothing to do.
  if (session.profile?.termsOfBusinessSignedAt) {
    redirect('/post-signin')
  }

  return (
    <ClientOnboarding
      initial={{
        fullName: session.profile?.fullName ?? '',
        phone: session.profile?.phone ?? '',
        roleSubtype: session.profile?.roleSubtype ?? '',
      }}
      userId={session.userId}
    />
  )
}
