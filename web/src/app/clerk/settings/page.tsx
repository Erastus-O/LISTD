import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  Award,
  Bell,
  Briefcase,
  ChevronRight,
  Star,
  TrendingUp,
} from 'lucide-react'
import { eq } from 'drizzle-orm'
import { Card, CardContent } from '@/components/ui/card'
import {
  AccountHeader,
  AccountPage,
  AccountSection,
  SettingsLinkCard,
} from '@/components/account/account-layout'
import { ChangePasswordForm } from '@/components/account/change-password-form'
import { AvatarUploader } from '@/components/role/avatar-uploader'
import { ConsentCard } from '@/components/legal/consent-card'
import { profiles, withServiceRole } from '@/db'
import { requireRole } from '@/lib/dal'
import { isStripeConfigured } from '@/lib/billing/stripe'
import { syncClerkConnectStatus } from '@/lib/billing/escrow'
import { getBookableServices } from '@/lib/pricing-matrix'
import { getEffectivePricing } from '@/lib/pricing-settings'
import { loadClerkProfileSettings } from '@/lib/profile/clerk-profile'
import { ClerkProfileForm } from './_components/clerk-profile-form'
import { StripePayoutsCard } from './_components/stripe-payouts-card'

export const metadata = { title: 'Pro Settings' }
export const dynamic = 'force-dynamic'

/**
 * Clerk settings (Lovable port of `ClerkProfile.tsx`).
 *
 * Layout (AccountPage sections):
 *   - Header: performance stats (Jobs · Rating · Level) + verification chip
 *   - Verification prompt (until verified), Payouts (Stripe Connect)
 *   - Profile: photo + editor (name, phone, coverage, services, languages,
 *     emergency contact)
 *   - Security (password), Notifications link, Legal and privacy
 *
 * Verification-affecting fields (DBS / insurance / qualification / gov ID)
 * are NOT editable from this page — they go through `/onboarding/clerk`
 * so changes re-trigger admin verification review.
 */
type Props = {
  searchParams: Promise<{ stripe?: string; payouts?: string }>
}

export default async function ClerkSettingsPage({ searchParams }: Props) {
  const session = await requireRole('clerk', 'trades', 'admin')
  // Returning from Stripe onboarding — pull the latest Connect status straight
  // from Stripe so the Payouts card is correct without waiting on the webhook.
  const sp = await searchParams
  if (sp.stripe === 'done') {
    await syncClerkConnectStatus(session.userId)
  }
  const profile = await loadClerkProfileSettings(session.userId, session.email)
  if (!profile) notFound()
  // Service list is driven by the live rate card — built-ins plus any
  // admin-defined custom types (configured on /admin/pricing). The form
  // used to hardcode this and miss anything outside the original five.
  const pricing = await getEffectivePricing()
  const services = getBookableServices(pricing).map((s) => ({
    key: s.key,
    label: s.label,
  }))

  const ratingDisplay = profile.clerkRating
    ? Number(profile.clerkRating).toFixed(1)
    : '0.0'

  // Stripe Connect payout state for this clerk.
  const [connect] = await withServiceRole((tx) =>
    tx
      .select({
        status: profiles.stripeOnboardingStatus,
        payoutsEnabled: profiles.stripePayoutsEnabled,
      })
      .from(profiles)
      .where(eq(profiles.userId, session.userId))
      .limit(1)
  )

  const verification = verificationChip(profile.verificationStatus)
  const needsVerification =
    !!profile.verificationStatus && profile.verificationStatus !== 'verified'

  return (
    <AccountPage
      header={
        <AccountHeader
          name={profile.fullName}
          email={profile.email}
          avatarUrl={session.profile?.avatarUrl ?? null}
          roleLabel="LISTD Pro"
          status={verification}
          stats={[
            {
              label: 'Jobs',
              value: String(profile.clerkJobsCompleted ?? 0),
              icon: Briefcase,
            },
            { label: 'Rating', value: ratingDisplay, icon: Star },
            {
              label: 'Level',
              value: `L${profile.clerkLevel ?? 1}`,
              icon: TrendingUp,
            },
          ]}
        />
      }
      nav={[
        ...(needsVerification
          ? [{ id: 'verification', label: 'Verification' }]
          : []),
        { id: 'payouts', label: 'Payouts' },
        { id: 'profile', label: 'Profile' },
        { id: 'security', label: 'Security' },
        { id: 'notifications', label: 'Notifications' },
        { id: 'privacy', label: 'Privacy' },
      ]}
    >
      {needsVerification && (
        <AccountSection
          id="verification"
          title="Verification"
          description="DBS, insurance and qualification documents are reviewed by our team."
        >
          <div className="flex items-start gap-4 rounded-2xl border border-amber-200 bg-amber-50 p-5 dark:border-amber-500/30 dark:bg-amber-500/10">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">
              <Award className="h-5 w-5" aria-hidden />
            </span>
            <div className="flex-1">
              <p className="text-sm font-semibold text-foreground">
                Verification: {verification?.label}
              </p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Update your DBS, insurance or qualification documents from the
                verification flow. Those changes need admin review.
              </p>
              <Link
                href="/onboarding/clerk"
                className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline underline-offset-4"
              >
                Open verification
                <ChevronRight className="h-4 w-4" aria-hidden />
              </Link>
            </div>
          </div>
        </AccountSection>
      )}

      <AccountSection
        id="payouts"
        title="Payouts"
        description="Where we send your earnings once a client approves your work."
      >
        <StripePayoutsCard
          configured={isStripeConfigured()}
          status={connect?.status ?? 'none'}
          payoutsEnabled={Boolean(connect?.payoutsEnabled)}
          highlight={sp.payouts === 'required'}
        />
      </AccountSection>

      <AccountSection
        id="profile"
        title="Profile"
        description="Your photo, contact details, coverage and the services you offer."
      >
        <Card>
          <CardContent className="space-y-3 p-6">
            <h3 className="text-base font-semibold">Profile photo</h3>
            <AvatarUploader
              userId={session.userId}
              initialAvatarUrl={session.profile?.avatarUrl ?? null}
              displayName={profile.fullName}
            />
          </CardContent>
        </Card>
        <ClerkProfileForm
          initial={{
            fullName: profile.fullName,
            phone: profile.phone,
            coverageAreas: profile.coverageAreas,
            serviceTypesOffered: profile.serviceTypesOffered,
            languages: profile.languages,
            emergencyContactName: profile.emergencyContactName,
            emergencyContactPhone: profile.emergencyContactPhone,
            email: profile.email,
          }}
          services={services}
        />
      </AccountSection>

      <AccountSection
        id="security"
        title="Security"
        description="Keep your account protected with a strong, unique password."
      >
        <ChangePasswordForm />
      </AccountSection>

      <AccountSection
        id="notifications"
        title="Notifications"
        description="Choose how we tell you about new jobs, payments and messages."
      >
        <SettingsLinkCard
          href="/account/notifications"
          icon={Bell}
          title="Notification preferences"
          description="Email, in-app, SMS and WhatsApp. Choose where we reach you."
        />
      </AccountSection>

      <AccountSection
        id="privacy"
        title="Legal and privacy"
        description="Your consent record and data rights."
      >
        <ConsentCard userId={session.userId} />
      </AccountSection>
    </AccountPage>
  )
}

function verificationChip(
  status: string | null | undefined
): { label: string; tone: 'success' | 'warning' | 'muted' } | undefined {
  if (!status) return undefined
  if (status === 'verified') return { label: 'Verified', tone: 'success' }
  if (status === 'pending_verification')
    return { label: 'Under review', tone: 'warning' }
  return { label: status.replace(/_/g, ' '), tone: 'warning' }
}
