import { eq } from 'drizzle-orm'
import { Card, CardContent } from '@/components/ui/card'
import {
  AccountHeader,
  AccountPage,
  AccountSection,
  DetailRow,
} from '@/components/account/account-layout'
import { ChangePasswordForm } from '@/components/account/change-password-form'
import { profiles, withServiceRole } from '@/db'
import { requireRole } from '@/lib/dal'
import { ConsentCard } from '@/components/legal/consent-card'
import { isStripeConfigured } from '@/lib/billing/stripe'
import { syncClerkConnectStatus } from '@/lib/billing/escrow'
import { StripePayoutsCard } from '../../clerk/settings/_components/stripe-payouts-card'

export const metadata = { title: 'Cleaner · Settings' }
export const dynamic = 'force-dynamic'

type Props = {
  searchParams: Promise<{ stripe?: string; payouts?: string }>
}

// Read-only account summary for the cleaner. Editable profile + coverage
// management land with the cleaner job marketplace (Stage 5).
export default async function CleanerSettingsPage({ searchParams }: Props) {
  const session = await requireRole('cleaner', 'admin')
  const p = session.profile
  const coverage = (p?.coverageAreas ?? []).filter(Boolean)
  const status = p?.verificationStatus ?? 'unverified'

  // Returning from Stripe onboarding: sync the latest payout flags so the
  // card is correct without waiting on the account.updated webhook.
  const sp = await searchParams
  if (sp.stripe === 'done') {
    await syncClerkConnectStatus(session.userId)
  }
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

  const statusLabel =
    status === 'verified'
      ? 'Verified'
      : status === 'pending_verification'
        ? 'Under review'
        : status === 'rejected'
          ? 'Changes requested'
          : status === 'suspended'
            ? 'Suspended'
            : 'Not started'

  return (
    <AccountPage
      header={
        <AccountHeader
          name={p?.fullName ?? null}
          email={session.email ?? null}
          avatarUrl={p?.avatarUrl ?? null}
          roleLabel="Cleaner"
          status={{
            label: statusLabel,
            tone:
              status === 'verified'
                ? 'success'
                : status === 'unverified'
                  ? 'muted'
                  : 'warning',
          }}
        />
      }
      nav={[
        { id: 'payouts', label: 'Payouts' },
        { id: 'profile', label: 'Profile' },
        { id: 'security', label: 'Security' },
        { id: 'privacy', label: 'Privacy' },
      ]}
    >
      {/* Payouts: Stripe Connect (set up / manage). Required before a cleaner
          can accept jobs so an approved clean has somewhere to pay them. */}
      <AccountSection
        id="payouts"
        title="Payouts"
        description="Set up payouts before accepting cleans, so approved work can be paid."
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
        description="Your account details and the areas you cover."
      >
        <Card>
          <CardContent className="p-6">
            <DetailRow label="Name">{p?.fullName ?? 'Not set'}</DetailRow>
            <DetailRow label="Email">{session.email ?? 'Not set'}</DetailRow>
            <DetailRow label="Phone">{p?.phone ?? 'Not set'}</DetailRow>
            <DetailRow label="Verification">{statusLabel}</DetailRow>
            <DetailRow label="Coverage">
              {coverage.length > 0 ? (
                <span className="flex flex-wrap gap-1.5">
                  {coverage.map((area) => (
                    <span
                      key={area}
                      className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary"
                    >
                      {area}
                    </span>
                  ))}
                </span>
              ) : (
                'Not set'
              )}
            </DetailRow>
          </CardContent>
        </Card>
        <p className="text-xs text-muted-foreground">
          Editing your profile, coverage and documents will be available here
          once the cleaning marketplace goes live.
        </p>
      </AccountSection>

      <AccountSection
        id="security"
        title="Security"
        description="Keep your account protected with a strong, unique password."
      >
        <ChangePasswordForm />
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
