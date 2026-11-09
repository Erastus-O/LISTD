import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { badRequest, created, errorResponse } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import { jobs, properties, withServiceRole } from '@/db'
import { logAuditEvent } from '@/lib/audit'
import { getBillingProvider } from '@/lib/billing/select'
import { BillingProviderNotImplementedError } from '@/lib/billing/provider'
import { cleaningLabelFromType, isCleaningType } from '@/lib/pricing-matrix'
import { computeHmoCleaningSplit } from '@/lib/cleaning/hmo-invoicing'

export const maxDuration = 60
export const runtime = 'nodejs'

type Params = Promise<{ jobId: string }>

const RequestSchema = z
  .object({
    /** Number of numbered bedrooms to invoice separately. Defaults to the
     *  property's bedroom count. The job's client price is split evenly across
     *  these + one communal line. */
    bedrooms: z.number().int().min(0).max(30).optional(),
  })
  .strict()

/**
 * POST /api/admin/jobs/[jobId]/hmo-invoices — generate SEPARATE draft invoices
 * per numbered bedroom + one for communal areas, for an HMO single-tenancy
 * cleaning job ("cleaning invoice to be separate for each numbered bedroom and
 * communal areas"). The job's client price is split evenly across the parts;
 * each part becomes its own draft invoice to the client, referencing the job,
 * so the property manager can charge each tenant individually.
 *
 * Drafts (not issued) so the admin can fine-tune individual amounts before
 * issuing. The job's `invoice_id` pointer is set to the first invoice.
 */
export async function POST(req: Request, { params }: { params: Params }) {
  const session = await authorizeRequest('admin')
  if (session instanceof Response) return session

  try {
    const { jobId } = await params
    const body = RequestSchema.parse(await req.json().catch(() => ({})))

    const job = await withServiceRole(async (tx) => {
      const [row] = await tx
        .select({
          id: jobs.id,
          clientId: jobs.clientId,
          organisationId: jobs.organisationId,
          inspectionType: jobs.inspectionType,
          quotedPrice: jobs.quotedPrice,
          invoiceId: jobs.invoiceId,
          addressLine1: properties.addressLine1,
          postcode: properties.postcode,
          bedrooms: properties.bedrooms,
        })
        .from(jobs)
        .leftJoin(properties, eq(properties.id, jobs.propertyId))
        .where(eq(jobs.id, jobId))
        .limit(1)
      return row ?? null
    })

    if (!job) return badRequest('Job not found')
    if (!isCleaningType(job.inspectionType)) {
      return badRequest('HMO per-bedroom invoicing is only for cleaning jobs.')
    }
    if (job.invoiceId) {
      return badRequest('This job already has an invoice. Void it first.')
    }
    const total = Number(job.quotedPrice ?? 0)
    if (total <= 0) {
      return badRequest('Job has no client price to split.')
    }
    const bedrooms = body.bedrooms ?? job.bedrooms ?? 0
    const split = computeHmoCleaningSplit(total, bedrooms)
    if (split.length === 0) return badRequest('Nothing to invoice.')

    const provider = await getBillingProvider()
    const levelLabel =
      cleaningLabelFromType(job.inspectionType) ?? 'Clean'
    const addr = job.addressLine1
      ? `${job.addressLine1}${job.postcode ? ', ' + job.postcode : ''}`
      : 'property'

    // One draft invoice per part (bedroom / communal).
    const createdInvoices: Array<{ id: string; reference: string | null }> = []
    for (const line of split) {
      const inv = await provider.createInvoice(
        {
          clientId: job.clientId,
          organisationId: job.organisationId ?? null,
          notes: `${levelLabel} : ${addr} : ${line.label} (HMO split)`,
          lineItems: [
            {
              description: `${levelLabel} clean : ${line.label} : ${addr}`,
              unitPrice: line.amount,
              jobId: job.id,
            },
          ],
        },
        session.userId
      )
      createdInvoices.push(inv)
    }

    // Point the job at the first invoice + audit the split.
    await withServiceRole(async (tx) => {
      await tx
        .update(jobs)
        .set({ invoiceId: createdInvoices[0].id })
        .where(eq(jobs.id, jobId))
      await logAuditEvent(tx, {
        category: 'billing',
        action: 'invoice.hmo_split_created',
        actorUserId: session.userId,
        targetType: 'job',
        targetId: jobId,
        payload: {
          inspectionType: job.inspectionType,
          bedrooms,
          total,
          count: createdInvoices.length,
          invoiceIds: createdInvoices.map((i) => i.id),
        },
      })
    })

    return created({
      count: createdInvoices.length,
      invoices: createdInvoices,
    })
  } catch (err) {
    if (err instanceof BillingProviderNotImplementedError) {
      return badRequest(err.message)
    }
    console.error('[admin/jobs/hmo-invoices] error:', err)
    return errorResponse(err)
  }
}
