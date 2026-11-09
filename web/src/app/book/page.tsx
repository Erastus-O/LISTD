import { redirect } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { profiles, withServiceRole } from '@/db'
import { requireSession } from '@/lib/dal'
import { loadUserProperties } from '@/lib/booking-data'
import { getPricing } from '@/lib/listd/pricing-settings'
import { findAutoApplyPromoForClient } from '@/lib/promo'
import { BookingWizard } from './booking-wizard'

export const metadata = { title: 'New booking' }

/**
 * `/book`: the booking wizard. Any mix of the six services for one property,
 * priced from the rate card; POSTs to /api/jobs/create.
 *
 * Must be a client (or admin) and have signed Terms of Business. Admins bypass.
 */
type Props = {
  searchParams: Promise<{ clientId?: string }>
}

export default async function BookJobPage({ searchParams }: Props) {
  const session = await requireSession()
  const isAdmin = session.roles.includes('admin')
  const isClient = session.roles.includes('client')

  if (!isClient && !isAdmin) {
    redirect('/post-signin')
  }

  if (!isAdmin && !session.profile?.termsOfBusinessSignedAt) {
    redirect('/onboarding/client')
  }

  // Admin booking ON BEHALF of a client (?clientId=…): the flow uses that
  // client's properties, the job is owned by them, and the payment link is
  // sent to their inbox + email. Admin-only — ignored for everyone else.
  const sp = await searchParams
  const onBehalfId = isAdmin && sp.clientId ? sp.clientId : null
  let onBehalf: { clientId: string; name: string } | null = null
  if (onBehalfId) {
    const [target] = await withServiceRole((tx) =>
      tx
        .select({ fullName: profiles.fullName, companyName: profiles.companyName })
        .from(profiles)
        .where(eq(profiles.userId, onBehalfId))
        .limit(1)
    )
    if (target) {
      onBehalf = {
        clientId: onBehalfId,
        name: target.companyName ?? target.fullName ?? 'client',
      }
    }
  }

  // Assigned promo (0036): a code attached to this client's account
  // auto-applies — prefilled on the review step, still removable.
  const [initialProperties, pricing, autoPromo] = await Promise.all([
    loadUserProperties(onBehalf?.clientId ?? session.userId),
    getPricing(),
    findAutoApplyPromoForClient(onBehalf?.clientId ?? session.userId),
  ])

  return (
    <BookingWizard
      initialProperties={initialProperties}
      pricing={pricing}
      onBehalf={onBehalf}
      initialPromo={
        autoPromo
          ? {
              code: autoPromo.code,
              kind: autoPromo.kind,
              percentOff: autoPromo.percentOff,
              serviceTypes: autoPromo.serviceTypes ?? [],
              autoApplied: true,
            }
          : null
      }
    />
  )
}
