import { asc, desc, eq } from 'drizzle-orm'
import { requireRole } from '@/lib/dal'
import { profiles, promoCodes, userRoles, withServiceRole } from '@/db'
import {
  getBookableServices,
  listCleanOfferings,
} from '@/lib/pricing-matrix'
import { getEffectivePricing } from '@/lib/pricing-settings'
import { PromosManager, type PromoRow } from './promos-manager'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Promo Codes — LISTD Admin' }

/**
 * /admin/promos — generate + manage promo codes (0035).
 *
 * Two kinds: percentage discounts scoped to service types, and
 * invoice-later codes that let a client post without paying (debt accrues,
 * consolidated month-end invoice + payment link via the daily
 * monthly-promo-billing cron). Lifecycle: validity window, redemption cap,
 * enable/disable, delete-while-unused.
 */
export default async function AdminPromosPage() {
  await requireRole('admin')

  const [rows, pricing, clientRows] = await Promise.all([
    withServiceRole((tx) =>
      tx.select().from(promoCodes).orderBy(desc(promoCodes.createdAt))
    ).catch(() => []),
    getEffectivePricing(),
    // Client accounts for the "assign to clients" picker (0036).
    withServiceRole((tx) =>
      tx
        .select({
          userId: profiles.userId,
          fullName: profiles.fullName,
          companyName: profiles.companyName,
        })
        .from(profiles)
        .innerJoin(userRoles, eq(userRoles.userId, profiles.userId))
        .where(eq(userRoles.role, 'client'))
        .orderBy(asc(profiles.fullName))
    ).catch(() => []),
  ])

  const clientOptions = clientRows.map((c) => ({
    userId: c.userId,
    name:
      (c.companyName
        ? `${c.fullName ?? 'Client'} — ${c.companyName}`
        : c.fullName) ?? 'Client',
  }))

  // Every bookable service (inspections + cleans) for the discount scope
  // picker. Keys match what jobs/create + cleaning/jobs/create validate.
  const serviceOptions = [
    ...getBookableServices(pricing).map((s) => ({
      key: s.key,
      label: s.label,
    })),
    ...listCleanOfferings(pricing.cleaning).map((o) => ({
      key: o.typeKey,
      label: `${o.label} (clean)`,
    })),
  ]

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div>
        <h1 className="font-semibold text-2xl text-foreground">Promo codes</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Generate and manage discount codes and monthly-account
          (invoice-later) codes. Disabled or expired codes stop working
          immediately; redemptions already on jobs are unaffected.
        </p>
      </div>
      <PromosManager
        initialPromos={rows as PromoRow[]}
        serviceOptions={serviceOptions}
        clientOptions={clientOptions}
      />
    </div>
  )
}
