import { redirect } from 'next/navigation'
import { requireSession } from '@/lib/dal'
import { getBookableServices } from '@/lib/pricing-matrix'
import { getEffectivePricing } from '@/lib/pricing-settings'
import { ClerkOnboarding } from './clerk-onboarding'

export const metadata = { title: 'Pro verification' }

/**
 * 5-step clerk verification onboarding (PRD §5.15 / M1 #5–6):
 *   1. Identity & Profile
 *   2. Coverage & Services
 *   3. DBS
 *   4. Qualifications
 *   5. Insurance (also the submit step — flips status to pending_verification)
 *
 * Documents land in the private `clerk-documents` Supabase Storage bucket
 * (apply [Listd-NEXT/sql/clerk_documents_bucket.sql](../../../sql/clerk_documents_bucket.sql)).
 */
export default async function ClerkOnboardingPage() {
  const session = await requireSession()

  // Non-clerks land back at the generic onboarding shell.
  if (
    !session.roles.includes('clerk') &&
    !session.roles.includes('admin') &&
    session.roles.length > 0
  ) {
    redirect('/onboarding')
  }

  // Under review — nothing to edit until the admin decides. VERIFIED clerks
  // are deliberately allowed in: this flow is also where they renew expiring
  // documents (the DBS/insurance expiry notifications link here, and the
  // settings page points here for doc updates). Bouncing them to the
  // dashboard left no way to re-upload before suspension.
  const status = session.profile?.verificationStatus ?? 'unverified'
  if (status === 'pending_verification') {
    redirect('/clerk/dashboard')
  }

  // Service list is driven by the live rate card — built-ins plus any
  // admin-defined custom types (configured on /admin/pricing). The form
  // used to hardcode this and was out of sync with the booking system,
  // saving e.g. 'inventory' for the New Inventory option (jobs are
  // actually created with 'new_inventory'), so verified clerks could
  // never see those jobs in their feed.
  const pricing = await getEffectivePricing()
  const serviceOptions = getBookableServices(pricing).map((s) => ({
    key: s.key,
    label: s.label,
  }))

  return (
    <ClerkOnboarding
      userId={session.userId}
      initial={{
        fullName: session.profile?.fullName ?? '',
        phone: session.profile?.phone ?? '',
        emergencyContactName: session.profile?.emergencyContactName ?? '',
        emergencyContactPhone: session.profile?.emergencyContactPhone ?? '',
        coverageAreas: session.profile?.coverageAreas ?? [],
        serviceTypesOffered: session.profile?.serviceTypesOffered ?? [],
        languages: session.profile?.languages ?? [],
      }}
      rejectionReason={session.profile?.verificationRejectionReason ?? null}
      serviceOptions={serviceOptions}
    />
  )
}
