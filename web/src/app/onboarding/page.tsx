import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { requireSession } from '@/lib/dal'
import { isPro } from '@/lib/listd/pro-services'
import { OnboardingActions } from './onboarding-actions'

export const metadata: Metadata = {
  title: 'Welcome to LISTD',
}

export default async function OnboardingPage() {
  const session = await requireSession()
  if (session.profile?.onboardingCompleted) redirect('/post-signin')

  // Dispatch to the role-specific multi-step flow. Empty `roles` falls
  // through to the role-picker below — never silently default to client.
  // One Pro onboarding, whatever services the Pro picked.
  const pro = isPro(session.roles)
  const isClient = session.roles.includes('client')
  if (pro && !isClient) redirect('/onboarding/clerk')
  if (isClient && !pro) redirect('/onboarding/client')

  return (
    <main className="min-h-screen bg-gradient-hero flex items-center justify-center px-4 py-12">
      <div className="bg-card rounded-2xl border border-border p-8 shadow-elevated max-w-lg w-full text-center space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground mb-2">
            Welcome to LISTD{session.profile?.fullName ? `, ${session.profile.fullName}` : ''}
          </h1>
          <p className="text-muted-foreground text-sm">
            Choose how you&rsquo;d like to continue. You can switch roles later
            from your account settings.
          </p>
        </div>
        <OnboardingActions />
      </div>
    </main>
  )
}
