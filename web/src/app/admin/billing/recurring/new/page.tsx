import Link from 'next/link'
import { asc, eq } from 'drizzle-orm'
import { ArrowLeft, RefreshCw } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { requireRole } from '@/lib/dal'
import { db, taxRates } from '@/db'
import { NewRecurringForm, type TaxRateOption } from './_components/new-recurring-form'

export const metadata = { title: 'Admin · New recurring template' }
export const dynamic = 'force-dynamic'

/**
 * Create-recurring-template page. Mirrors the manual invoice create
 * form but with cadence controls and an `auto_action` selector. Once
 * saved the row joins the cron-managed pool and the daily sweep at
 * /api/cron/issue-recurring takes over.
 */
export default async function NewRecurringPage() {
  await requireRole('admin')

  const rateRows = await db
    .select({
      id: taxRates.id,
      code: taxRates.code,
      name: taxRates.name,
      rate: taxRates.rate,
      isDefault: taxRates.isDefault,
    })
    .from(taxRates)
    .where(eq(taxRates.isActive, true))
    .orderBy(asc(taxRates.name))

  const rates: TaxRateOption[] = rateRows.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    rate: Number(r.rate),
    isDefault: r.isDefault,
  }))
  const defaultRate = rates.find((r) => r.isDefault) ?? null

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 px-6 py-10">
      <Link
        href="/admin/billing/recurring"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to recurring
      </Link>

      <div className="flex items-center gap-2">
        <RefreshCw className="h-6 w-6 text-muted-foreground" />
        <div>
          <h1 className="font-display text-3xl text-foreground">
            New recurring template
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Mints a draft invoice on the chosen cadence. Per the auto-action
            it can stop at draft, auto-issue (allocates reference + renders
            PDF), or auto-issue and email the client.
          </p>
        </div>
      </div>

      <Card>
        <CardContent className="p-6">
          <NewRecurringForm
            rates={rates}
            defaultRateId={defaultRate?.id ?? null}
          />
        </CardContent>
      </Card>
    </div>
  )
}
