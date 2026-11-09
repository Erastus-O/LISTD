import { notFound } from 'next/navigation'
import { and, eq } from 'drizzle-orm'
import { Bell, Building2 } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import {
  AccountHeader,
  AccountPage,
  AccountSection,
  DetailRow,
  SettingsLinkCard,
} from '@/components/account/account-layout'
import { ChangePasswordForm } from '@/components/account/change-password-form'
import { AvatarUploader } from '@/components/role/avatar-uploader'
import { ConsentCard } from '@/components/legal/consent-card'
import { organisationMembers, organisations, withServiceRole } from '@/db'
import { requireRole } from '@/lib/dal'
import { loadClientProfileSettings } from '@/lib/profile/client-profile'
import { ClientProfileForm } from './_components/client-profile-form'
import { WorkerPaymentModeCard } from './_components/worker-payment-mode-card'

export const metadata = { title: 'Client Settings' }
export const dynamic = 'force-dynamic'

/**
 * Client settings (Lovable port of `SettingsPage.tsx`).
 *
 * Layout (AccountPage sections):
 *   - Profile: photo + editor (name, phone, company)
 *   - Security: password change
 *   - Notifications: link to /account/notifications
 *   - Organisation: read-only details + owner-only worker payment setting
 *   - Legal and privacy: consent record
 */
export default async function ClientSettingsPage() {
  const session = await requireRole('client', 'admin')
  const profile = await loadClientProfileSettings(
    session.userId,
    session.email
  )
  if (!profile) notFound()

  // Owner-only: the worker-post payment setting. Null for non-owners / solo
  // clients, who don't see the card. Defensive: the column ships with
  // migration 0032 — on a DB that hasn't run it yet, hide the card instead
  // of 500ing the whole settings page.
  const ownerOrg = await withServiceRole((tx) =>
    tx
      .select({ mode: organisations.workerPostPaymentMode })
      .from(organisationMembers)
      .innerJoin(
        organisations,
        eq(organisations.id, organisationMembers.organisationId)
      )
      .where(
        and(
          eq(organisationMembers.userId, session.userId),
          eq(organisationMembers.status, 'active'),
          eq(organisationMembers.orgRole, 'owner')
        )
      )
      .limit(1)
      .then((r) => r[0])
  ).catch(() => undefined)

  return (
    <AccountPage
      header={
        <AccountHeader
          name={profile.fullName}
          email={profile.email}
          avatarUrl={session.profile?.avatarUrl ?? null}
          roleLabel="Client"
          status={
            profile.organisation?.name
              ? { label: profile.organisation.name, tone: 'muted' }
              : undefined
          }
        />
      }
      nav={[
        { id: 'profile', label: 'Profile' },
        { id: 'security', label: 'Security' },
        { id: 'notifications', label: 'Notifications' },
        ...(profile.organisation || ownerOrg
          ? [{ id: 'organisation', label: 'Organisation' }]
          : []),
        { id: 'privacy', label: 'Privacy' },
      ]}
    >
      <AccountSection
        id="profile"
        title="Profile"
        description="Your photo and the contact details Pros and our team see."
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
        <ClientProfileForm
          initial={{
            fullName: profile.fullName,
            phone: profile.phone,
            companyName: profile.companyName,
            email: profile.email,
          }}
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
        description="Choose how we keep you updated about jobs, reports and payments."
      >
        <SettingsLinkCard
          href="/account/notifications"
          icon={Bell}
          title="Notification preferences"
          description="Email, in-app, SMS and WhatsApp. Choose where we reach you."
        />
      </AccountSection>

      {(profile.organisation || ownerOrg) && (
        <AccountSection
          id="organisation"
          title="Organisation"
          description="The company account your bookings and invoices belong to."
        >
          {profile.organisation && (
            <Card>
              <CardContent className="p-6">
                <h3 className="flex items-center gap-1.5 text-base font-semibold">
                  <Building2 className="h-4 w-4" aria-hidden />
                  Organisation details
                </h3>
                <p className="mt-1 mb-2 text-xs text-muted-foreground">
                  Read-only. Organisation-level fields are managed by our team,
                  so contact support to change them.
                </p>
                <DetailRow label="Name">
                  {profile.organisation.name ?? 'Not set'}
                </DetailRow>
                {profile.organisation.billingAddress && (
                  <DetailRow label="Billing">
                    {profile.organisation.billingAddress}
                  </DetailRow>
                )}
                {profile.organisation.vatNumber && (
                  <DetailRow label="VAT">
                    {profile.organisation.vatNumber}
                  </DetailRow>
                )}
                {profile.organisation.companyRegNumber && (
                  <DetailRow label="Co. Reg">
                    {profile.organisation.companyRegNumber}
                  </DetailRow>
                )}
              </CardContent>
            </Card>
          )}

          {/* Owner-only: who pays for workers' posts */}
          {ownerOrg && (
            <WorkerPaymentModeCard
              initialMode={
                ownerOrg.mode === 'worker_pays' ? 'worker_pays' : 'owner_link'
              }
            />
          )}
        </AccountSection>
      )}

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
