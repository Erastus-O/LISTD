import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { errorResponse, noContent } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import { platformSettings, withServiceRole } from '@/db'
import { callerIp, callerUserAgent, logAuditEvent } from '@/lib/audit'

export const maxDuration = 15
export const runtime = 'nodejs'

const CompanySchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    address: z.string().trim().max(800).default(''),
    contact: z.string().trim().max(300).default(''),
  })
  .strict()

const RequestSchema = z
  .object({
    /** 'inbuilt' | 'xero' — controls which BillingProvider serves invoices. */
    invoiceProvider: z.enum(['inbuilt', 'xero']).optional(),
    /** Company block rendered on the invoice PDF (top-right). */
    companyDetails: CompanySchema.optional(),
    /** VAT registration number rendered on the PDF. Empty string clears it. */
    vatNumber: z.string().trim().max(60).optional(),
    /** Free-text payment instructions panel at the bottom of the PDF. */
    paymentInstructions: z.string().trim().max(2000).optional(),
  })
  .strict()
  .refine(
    (v) =>
      v.invoiceProvider !== undefined ||
      v.companyDetails !== undefined ||
      v.vatNumber !== undefined ||
      v.paymentInstructions !== undefined,
    { message: 'No fields to update' }
  )

/**
 * PATCH /api/admin/billing/settings — admin-only writes for the invoice
 * generator's platform_settings keys:
 *   - invoice_provider              ('inbuilt' | 'xero')
 *   - invoice_company_details       (JSON: name, address, contact)
 *   - invoice_vat_registration_number
 *   - invoice_payment_instructions
 *
 * Each delta writes a `platform_setting/platform_setting.updated` audit row
 * with before/after values. Provider toggles additionally write a
 * `billing/provider.changed` row so the lifecycle of the active backend is
 * traceable independently of the generic platform-setting audit stream.
 */
export async function PATCH(req: Request) {
  const session = await authorizeRequest('admin')
  if (session instanceof Response) return session

  try {
    const body = RequestSchema.parse(await req.json())
    const ip = callerIp(req)
    const ua = callerUserAgent(req)

    const writes: Array<{ key: string; value: string; category: 'provider' | 'setting' }> = []
    if (body.invoiceProvider !== undefined) {
      writes.push({
        key: 'invoice_provider',
        value: body.invoiceProvider,
        category: 'provider',
      })
    }
    if (body.companyDetails !== undefined) {
      writes.push({
        key: 'invoice_company_details',
        value: JSON.stringify(body.companyDetails),
        category: 'setting',
      })
    }
    if (body.vatNumber !== undefined) {
      writes.push({
        key: 'invoice_vat_registration_number',
        value: body.vatNumber,
        category: 'setting',
      })
    }
    if (body.paymentInstructions !== undefined) {
      writes.push({
        key: 'invoice_payment_instructions',
        value: body.paymentInstructions,
        category: 'setting',
      })
    }

    await withServiceRole(async (tx) => {
      for (const w of writes) {
        const [existing] = await tx
          .select({ value: platformSettings.value })
          .from(platformSettings)
          .where(sql`${platformSettings.key} = ${w.key}`)
          .limit(1)
        const before = existing?.value ?? null
        if (before === w.value) continue

        await tx
          .insert(platformSettings)
          .values({
            key: w.key,
            value: w.value,
            updatedBy: session.userId,
            updatedAt: sql`now()`,
          })
          .onConflictDoUpdate({
            target: platformSettings.key,
            set: {
              value: w.value,
              updatedBy: session.userId,
              updatedAt: sql`now()`,
            },
          })

        await logAuditEvent(tx, {
          category: 'platform_setting',
          action: 'platform_setting.updated',
          actorUserId: session.userId,
          targetType: 'platform_setting',
          targetId: w.key,
          payload: { key: w.key, before, after: w.value },
          ipAddress: ip,
          userAgent: ua,
        })

        if (w.category === 'provider') {
          await logAuditEvent(tx, {
            category: 'billing',
            action: 'provider.changed',
            actorUserId: session.userId,
            targetType: 'billing_provider',
            targetId: w.value,
            payload: { before, after: w.value },
            ipAddress: ip,
            userAgent: ua,
          })
        }
      }
    })

    return noContent()
  } catch (err) {
    console.error('[admin/billing/settings] error:', err)
    return errorResponse(err)
  }
}
