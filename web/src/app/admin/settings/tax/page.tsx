import Link from 'next/link'
import { asc, inArray } from 'drizzle-orm'
import { ArrowLeft, Percent } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { requireRole } from '@/lib/dal'
import { db, invoiceNumbering, platformSettings, taxRates } from '@/db'
import { TaxRatesCard } from './_components/tax-rates-card'
import { CompanyDetailsForm } from './_components/company-details-form'
import { NumberingCard } from './_components/numbering-card'

export const metadata = { title: 'Admin · Tax & invoicing' }
export const dynamic = 'force-dynamic'

const PLATFORM_KEYS = [
  'invoice_company_details',
  'invoice_vat_registration_number',
  'invoice_payment_instructions',
] as const

/**
 * Tax & invoicing settings hub. Three cards:
 *   1. Tax rate library — CRUD via /api/admin/billing/tax-rates
 *   2. Company details + VAT + payment instructions — written to
 *      platform_settings via /api/admin/billing/settings
 *   3. Numbering preview — read-only view of `invoice_numbering` so admin
 *      knows the next reference allocation per year
 */
export default async function AdminTaxSettingsPage() {
  await requireRole('admin')

  const [rateRows, settingRows, numberingRows] = await Promise.all([
    db
      .select({
        id: taxRates.id,
        code: taxRates.code,
        name: taxRates.name,
        rate: taxRates.rate,
        isActive: taxRates.isActive,
        isDefault: taxRates.isDefault,
        appliesTo: taxRates.appliesTo,
        notes: taxRates.notes,
        xeroTaxType: taxRates.xeroTaxType,
      })
      .from(taxRates)
      .orderBy(asc(taxRates.isActive), asc(taxRates.name)),
    db
      .select({
        key: platformSettings.key,
        value: platformSettings.value,
      })
      .from(platformSettings)
      .where(inArray(platformSettings.key, [...PLATFORM_KEYS])),
    db
      .select({
        year: invoiceNumbering.year,
        nextNumber: invoiceNumbering.nextNumber,
        updatedAt: invoiceNumbering.updatedAt,
      })
      .from(invoiceNumbering)
      .orderBy(asc(invoiceNumbering.year)),
  ])

  const settingMap = new Map(settingRows.map((r) => [r.key, r.value ?? '']))
  const companyJson = settingMap.get('invoice_company_details') ?? ''
  const company = parseCompany(companyJson)

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 px-6 py-10">
      <Link
        href="/admin/settings"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to settings
      </Link>

      <div className="flex items-center gap-2">
        <Percent className="h-6 w-6 text-muted-foreground" />
        <div>
          <h1 className="font-display text-3xl text-foreground">
            Tax &amp; invoicing
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Tax-rate library, company-block details on the invoice PDF, and
            the per-year invoice numbering preview.
          </p>
        </div>
      </div>

      <Card>
        <CardContent className="space-y-3 p-6">
          <h2 className="text-base font-semibold text-foreground">Tax rates</h2>
          <p className="text-xs text-muted-foreground">
            Rates the line-item editor offers. Marking a rate as default
            pre-selects it on new lines. Deactivating hides a rate from new
            invoices but leaves existing ones untouched.
          </p>
          <TaxRatesCard
            rows={rateRows.map((r) => ({
              id: r.id,
              code: r.code,
              name: r.name,
              rate: Number(r.rate),
              isActive: r.isActive,
              isDefault: r.isDefault,
              appliesTo: r.appliesTo,
              notes: r.notes,
              xeroTaxType: r.xeroTaxType,
            }))}
          />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 p-6">
          <h2 className="text-base font-semibold text-foreground">
            Company details on the PDF
          </h2>
          <p className="text-xs text-muted-foreground">
            Renders in the top-right of the invoice PDF and in the footer.
            Leave VAT number blank if you&rsquo;re not VAT-registered.
          </p>
          <CompanyDetailsForm
            initial={{
              name: company.name,
              address: company.address,
              contact: company.contact,
              vatNumber: settingMap.get('invoice_vat_registration_number') ?? '',
              paymentInstructions:
                settingMap.get('invoice_payment_instructions') ?? '',
            }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 p-6">
          <h2 className="text-base font-semibold text-foreground">
            Invoice numbering
          </h2>
          <p className="text-xs text-muted-foreground">
            Format: <span className="font-mono">INV-YYYY-NNNNN</span>. Each
            year starts at 1 and increments atomically when an invoice is
            issued. Reset is destructive: only use it on a fresh year before
            issuing anything.
          </p>
          <NumberingCard rows={numberingRows} />
        </CardContent>
      </Card>
    </div>
  )
}

function parseCompany(raw: string): {
  name: string
  address: string
  contact: string
} {
  if (!raw) return { name: '', address: '', contact: '' }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    return {
      name: typeof parsed.name === 'string' ? parsed.name : '',
      address: typeof parsed.address === 'string' ? parsed.address : '',
      contact: typeof parsed.contact === 'string' ? parsed.contact : '',
    }
  } catch {
    return { name: '', address: '', contact: '' }
  }
}

