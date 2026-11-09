import { redirect } from 'next/navigation'
import { requireSession } from '@/lib/dal'
import { CleanerOnboarding } from './cleaner-onboarding'

export const metadata = { title: 'Cleaner verification' }

/**
 * Cleaner verification onboarding — a streamlined single-form flow (identity +
 * ID, coverage areas, DBS, insurance) that submits to
 * [POST /api/onboarding/cleaner/submit](../../api/onboarding/cleaner/submit/route.ts).
 *
 * Reuses the shared verification `profiles` columns + the private
 * `clerk-documents` Supabase Storage bucket, so the admin review surface at
 * /admin/clerks/[id] works unchanged.
 */
export default async function CleanerOnboardingPage() {
  const session = await requireSession()

  // Non-cleaners land back at the generic onboarding shell.
  if (
    !session.roles.includes('cleaner') &&
    !session.roles.includes('admin') &&
    session.roles.length > 0
  ) {
    redirect('/onboarding')
  }

  const status = session.profile?.verificationStatus ?? 'unverified'
  if (status === 'pending_verification' || status === 'verified') {
    redirect('/cleaner/dashboard')
  }

  return (
    <CleanerOnboarding
      userId={session.userId}
      initial={{
        fullName: session.profile?.fullName ?? '',
        phone: session.profile?.phone ?? '',
        emergencyContactName: session.profile?.emergencyContactName ?? '',
        emergencyContactPhone: session.profile?.emergencyContactPhone ?? '',
        coverageAreas: session.profile?.coverageAreas ?? [],
      }}
      rejectionReason={session.profile?.verificationRejectionReason ?? null}
    />
  )
}
