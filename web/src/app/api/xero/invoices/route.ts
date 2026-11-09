import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { errorResponse, forbidden, notFound, ok } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import {
  XERO_API_BASE,
  fetchXeroWithRetry,
  getValidXeroAccess,
  xeroHeaders,
} from '@/lib/xero'
import {
  jobs,
  notifications,
  properties,
  userRoles,
  withRLS,
  withServiceRole,
} from '@/db'

export const maxDuration = 30
export const runtime = 'nodejs'

const RequestSchema = z.object({
  job_id: z.string().uuid(),
})

const INSPECTION_LABELS: Record<string, string> = {
  new_inventory: 'New Inventory',
  check_in: 'Check-In',
  check_out: 'Check-Out',
  mid_term: 'Mid-Term Inspection',
  interim: 'Interim Inspection',
}

/**
 * POST /api/xero/invoices — create a Xero invoice for a LISTD job (M2 #2).
 *
 * Hardening over the M-Pre port:
 *   - **Idempotency.** Xero `Idempotency-Key` set to `job:<jobId>:invoice` so
 *     a network blip mid-create can't double-bill. Subsequent calls with the
 *     same key return the original invoice payload.
 *   - **Retry.** 429 / 5xx / network errors retry up to 3× with exponential
 *     backoff (respects 429 `Retry-After`). 4xx other than 429 fail fast so
 *     the caller can show validation errors immediately.
 *   - **Admin queue.** On terminal failure, an in-app notification is filed
 *     for every admin pointing at the job; one row per admin keeps the
 *     existing notification dedupe semantics.
 */
export async function POST(req: Request) {
  const session = await authorizeRequest()
  if (session instanceof Response) return session

  try {
    const body = await req.json()
    const { job_id } = RequestSchema.parse(body)

    // Confirm the caller owns this job (RLS enforces visibility).
    const ownsJob = await withRLS(session, async (tx) => {
      const rows = await tx
        .select({ id: jobs.id })
        .from(jobs)
        .where(eq(jobs.id, job_id))
        .limit(1)
      return rows.length > 0
    })
    if (!ownsJob) return forbidden('Not authorized for this job')

    // Pull the full job + property via service role (we just verified
    // ownership; widening to include all columns is now safe).
    const job = await withServiceRole(async (tx) => {
      const [row] = await tx
        .select({
          id: jobs.id,
          inspectionType: jobs.inspectionType,
          finalPrice: jobs.finalPrice,
          quotedPrice: jobs.quotedPrice,
          addressLine1: properties.addressLine1,
          addressLine2: properties.addressLine2,
          city: properties.city,
          postcode: properties.postcode,
        })
        .from(jobs)
        .leftJoin(properties, eq(jobs.propertyId, properties.id))
        .where(eq(jobs.id, job_id))
        .limit(1)
      return row
    })
    if (!job) return notFound('Job not found')

    const access = await getValidXeroAccess(session.userId)

    const price = Number(job.finalPrice ?? job.quotedPrice ?? 0)
    const address = job.addressLine1
      ? `${job.addressLine1}, ${job.city ?? ''}, ${job.postcode ?? ''}`
      : 'Property inspection'
    const inspectionLabel =
      INSPECTION_LABELS[job.inspectionType] ?? job.inspectionType
    const reference = `LISTD-${job.id.substring(0, 8).toUpperCase()}`

    const invoicePayload = {
      Type: 'ACCREC',
      Contact: { Name: address },
      Date: new Date().toISOString().split('T')[0],
      DueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split('T')[0],
      LineAmountTypes: 'Inclusive',
      LineItems: [
        {
          Description: `${inspectionLabel} : ${address}`,
          Quantity: 1,
          UnitAmount: price,
          AccountCode: '200',
        },
      ],
      Reference: reference,
      Status: 'AUTHORISED',
    }

    const result = await fetchXeroWithRetry<{
      Invoices?: Array<{
        InvoiceID?: string
        InvoiceNumber?: string
      }>
    }>(
      `${XERO_API_BASE}/Invoices`,
      {
        method: 'POST',
        headers: xeroHeaders(access),
        body: JSON.stringify({ Invoices: [invoicePayload] }),
      },
      access,
      { idempotencyKey: `job:${job.id}:invoice` }
    )

    if (!result.ok) {
      console.error(
        `[xero/invoices] failed status=${result.status} attempts=${result.attempts}:`,
        result.error
      )
      // Surface to admin queue for triage.
      await notifyAdminsOfFailure({
        jobId: job.id,
        reference,
        status: result.status,
        retryable: result.retryable,
      })
      return Response.json(
        {
          error: 'Failed to create Xero invoice',
          status: result.status,
          retryable: result.retryable,
          details: result.error,
        },
        { status: 502 }
      )
    }

    const created = result.data.Invoices?.[0]
    return ok({
      success: true,
      invoice_id: created?.InvoiceID,
      invoice_number: created?.InvoiceNumber,
      reference,
      amount: price,
    })
  } catch (err) {
    return errorResponse(err)
  }
}

/**
 * Insert one notification per admin pointing at the job. Idempotent within
 * the same calendar day on (admin, job) pairing — same dedupe pattern used
 * in /api/cron/xero-invoice-reconciliation.
 */
async function notifyAdminsOfFailure(params: {
  jobId: string
  reference: string
  status: number
  retryable: boolean
}): Promise<void> {
  await withServiceRole(async (tx) => {
    const admins = await tx
      .select({ userId: userRoles.userId })
      .from(userRoles)
      .where(eq(userRoles.role, 'admin'))
    if (admins.length === 0) return

    const link = `/admin/jobs/${params.jobId}`
    const message =
      params.retryable && params.status === 0
        ? `Xero invoice for ${params.reference} failed after retries (network error).`
        : `Xero invoice for ${params.reference} returned HTTP ${params.status} after retries.`

    await tx.insert(notifications).values(
      admins.map((a) => ({
        userId: a.userId,
        type: 'xero_invoice_failed',
        title: 'Xero invoice failed',
        message,
        link,
      }))
    )
  })
}
