import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { and, asc, eq } from 'drizzle-orm'
import { ArrowLeft, FilePlus2 } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { requireRole } from '@/lib/dal'
import { loadBillingProviderId } from '@/lib/billing/select'
import { db, jobs, profiles, properties, taxRates } from '@/db'
import { NewInvoiceForm, type SeedClient, type SeedLine, type TaxRateOption } from './_components/new-invoice-form'

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export const metadata = { title: 'Admin · New invoice' }
export const dynamic = 'force-dynamic'

/**
 * Admin "create invoice" page. Optionally seeded from a delivered job via
 * `?fromJob=<id>` — the job's client, address, and final price pre-fill
 * the line item.
 *
 * When the active billing provider isn't `inbuilt`, we bounce back to the
 * list page (which renders a friendly empty state pointing to the toggle).
 */
export default async function NewInvoicePage({ searchParams }: Props) {
  await requireRole('admin')

  const providerId = await loadBillingProviderId()
  if (providerId !== 'inbuilt') {
    redirect('/admin/invoices')
  }

  const sp = await searchParams
  const fromJob = typeof sp.fromJob === 'string' ? sp.fromJob : null

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

  let seedClient: SeedClient | null = null
  let seedLines: SeedLine[] | null = null

  if (fromJob) {
    const [row] = await db
      .select({
        id: jobs.id,
        clientId: jobs.clientId,
        organisationId: jobs.organisationId,
        finalPrice: jobs.finalPrice,
        quotedPrice: jobs.quotedPrice,
        jobRefNumber: jobs.jobRefNumber,
        inspectionType: jobs.inspectionType,
        scheduledDate: jobs.scheduledDate,
        clientFullName: profiles.fullName,
        clientCompany: profiles.companyName,
        propAddress: properties.addressLine1,
        propPostcode: properties.postcode,
      })
      .from(jobs)
      .leftJoin(profiles, eq(profiles.userId, jobs.clientId))
      .leftJoin(properties, eq(properties.id, jobs.propertyId))
      .where(and(eq(jobs.id, fromJob)))
      .limit(1)
    if (!row) notFound()

    seedClient = {
      userId: row.clientId,
      fullName: row.clientFullName ?? '(no name)',
      companyName: row.clientCompany,
    }
    const refLabel = `LST-${row.jobRefNumber.toString().padStart(5, '0')}`
    const addressLabel = [row.propAddress, row.propPostcode]
      .filter(Boolean)
      .join(', ')
    const description = [
      `${refLabel} · ${row.inspectionType} inspection`,
      addressLabel || null,
    ]
      .filter(Boolean)
      .join(' : ')
    const unitPrice = Number(row.finalPrice ?? row.quotedPrice ?? 0)
    seedLines = [
      {
        description,
        quantity: 1,
        unitPrice,
        taxRateId: defaultRate?.id ?? null,
        jobId: row.id,
      },
    ]
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 px-6 py-10">
      <Link
        href="/admin/invoices"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to invoices
      </Link>

      <div className="flex items-center gap-2">
        <FilePlus2 className="h-6 w-6 text-muted-foreground" />
        <div>
          <h1 className="font-display text-3xl text-foreground">New invoice</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            {fromJob
              ? 'Seeded from the originating job : review the line item before saving.'
              : 'Drafts can be edited up until you issue them.'}
          </p>
        </div>
      </div>

      <Card>
        <CardContent className="p-6">
          <NewInvoiceForm
            rates={rates}
            defaultRateId={defaultRate?.id ?? null}
            seedClient={seedClient}
            seedLines={seedLines}
          />
        </CardContent>
      </Card>
    </div>
  )
}
