import { requireRole } from '@/lib/dal'
import { getPricing } from '@/lib/listd/pricing-settings'
import { RateCardEditor } from './rate-card-editor'

export const metadata = { title: 'Admin · Pricing' }
export const dynamic = 'force-dynamic'

/** The rate card: website, client quotes and Pro fees all read these figures. */
export default async function AdminPricingPage() {
  await requireRole('admin')
  return <RateCardEditor initial={await getPricing()} />
}
