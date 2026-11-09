import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { errorResponse, notFound, ok } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import {
  XERO_API_BASE,
  fetchXeroWithRetry,
  getValidXeroAccess,
  xeroHeaders,
} from '@/lib/xero'
import { notifications, userRoles, withServiceRole } from '@/db'

export const maxDuration = 30
export const runtime = 'nodejs'

const PostSchema = z.object({
  job_id: z.string().uuid(),
  amount: z.number().positive().optional(),
})

const DeleteSchema = z.object({
  job_id: z.string().uuid(),
  payment_id: z.string().min(1),
})

type Invoice = {
  InvoiceID?: string
  InvoiceNumber?: string
  Reference?: string
  AmountDue?: number
  Total?: number
}

type Payment = {
  PaymentID?: string
  Reference?: string
  Status?: string
}

/**
 * POST /api/xero/payments — record a payment against the Xero invoice for a
 * LISTD job (M2 #3).
 *
 * Hardening over the M-Pre port:
 *   - **Retry / idempotency.** Both the invoice lookup and the payment PUT
 *     go through [`fetchXeroWithRetry`](../../../../lib/xero.ts). The PUT
 *     uses `Idempotency-Key: job:<jobId>:payment` so retries can't
 *     double-record.
 *   - **Reconcile to job.** Verifies the invoice exists for the job's
 *     `LISTD-<id>` reference; surfaces a clear 404 if it doesn't.
 *   - **Admin queue on terminal failure.** Same shape as the M2 #2 invoice
 *     hardening — a `xero_payment_failed` notification per admin pointing
 *     at /admin/jobs/<id>.
 *
 * Audit-log dependency: when the M1 #22 `audit_events` table lands, this
 * handler should also `logAuditEvent({ category: 'job_lifecycle',
 * action: 'job.paid', payload: { paymentId, amount } })`. Inline TODO below.
 */
export async function POST(req: Request) {
  const session = await authorizeRequest()
  if (session instanceof Response) return session

  try {
    const body = await req.json()
    const { job_id, amount } = PostSchema.parse(body)
    const access = await getValidXeroAccess(session.userId)
    const jobRef = `LISTD-${job_id.substring(0, 8).toUpperCase()}`

    // Find the invoice by reference. Encode the where-clause so quotes
    // don't get mangled in transit.
    const where = encodeURIComponent(`Reference=="${jobRef}"`)
    const search = await fetchXeroWithRetry<{ Invoices?: Invoice[] }>(
      `${XERO_API_BASE}/Invoices?where=${where}&Statuses=AUTHORISED`,
      { headers: xeroHeaders(access) },
      access
    )
    if (!search.ok) {
      console.error(
        `[xero/payments] invoice lookup failed status=${search.status}:`,
        search.error
      )
      return Response.json(
        {
          error: 'Failed to find Xero invoice',
          status: search.status,
          retryable: search.retryable,
          details: search.error,
        },
        { status: 502 }
      )
    }
    const invoice = search.data.Invoices?.[0]
    if (!invoice?.InvoiceID) {
      return notFound(
        `No matching Xero invoice found for reference ${jobRef}. Create the invoice first before recording a payment.`
      )
    }

    const paymentAmount =
      amount ?? invoice.AmountDue ?? invoice.Total ?? 0
    const paymentReference = `LISTD-PAY-${job_id.substring(0, 8).toUpperCase()}`

    const result = await fetchXeroWithRetry<{ Payments?: Payment[] }>(
      `${XERO_API_BASE}/Payments`,
      {
        method: 'PUT',
        headers: xeroHeaders(access),
        body: JSON.stringify({
          Invoice: { InvoiceID: invoice.InvoiceID },
          Account: { Code: '090' },
          Date: new Date().toISOString().split('T')[0],
          Amount: paymentAmount,
          Reference: paymentReference,
        }),
      },
      access,
      { idempotencyKey: `job:${job_id}:payment` }
    )

    if (!result.ok) {
      console.error(
        `[xero/payments] failed status=${result.status} attempts=${result.attempts}:`,
        result.error
      )
      await notifyAdminsOfPaymentFailure({
        jobId: job_id,
        reference: jobRef,
        status: result.status,
        retryable: result.retryable,
        action: 'record',
      })
      return Response.json(
        {
          error: 'Failed to record Xero payment',
          status: result.status,
          retryable: result.retryable,
          details: result.error,
        },
        { status: 502 }
      )
    }

    const created = result.data.Payments?.[0]
    return ok({
      success: true,
      payment_id: created?.PaymentID,
      invoice_id: invoice.InvoiceID,
      invoice_number: invoice.InvoiceNumber,
      amount: paymentAmount,
      reference: paymentReference,
    })
  } catch (err) {
    return errorResponse(err)
  }
}

/**
 * DELETE /api/xero/payments — void a previously-recorded Xero payment.
 *
 * Xero doesn't physically delete; it transitions Status from `AUTHORISED`
 * to `DELETED`. Same effect for AmountDue purposes. Idempotency-Key uses
 * the payment id so a retry of the same void is a no-op.
 *
 * Body: `{ job_id, payment_id }`. The job_id is used purely for the admin-
 * queue notification + audit-log link; we don't re-fetch the payment to
 * confirm it belongs to the caller — the auth gate plus the per-payment id
 * is the trust boundary.
 */
export async function DELETE(req: Request) {
  const session = await authorizeRequest()
  if (session instanceof Response) return session

  try {
    const { job_id, payment_id } = DeleteSchema.parse(await req.json())
    const access = await getValidXeroAccess(session.userId)

    const result = await fetchXeroWithRetry<{ Payments?: Payment[] }>(
      `${XERO_API_BASE}/Payments/${encodeURIComponent(payment_id)}`,
      {
        method: 'POST',
        headers: xeroHeaders(access),
        body: JSON.stringify({
          Payments: [{ PaymentID: payment_id, Status: 'DELETED' }],
        }),
      },
      access,
      { idempotencyKey: `payment:${payment_id}:void` }
    )

    if (!result.ok) {
      console.error(
        `[xero/payments DELETE] failed status=${result.status} attempts=${result.attempts}:`,
        result.error
      )
      await notifyAdminsOfPaymentFailure({
        jobId: job_id,
        reference: `LISTD-PAY-${job_id.substring(0, 8).toUpperCase()}`,
        status: result.status,
        retryable: result.retryable,
        action: 'void',
      })
      return Response.json(
        {
          error: 'Failed to void Xero payment',
          status: result.status,
          retryable: result.retryable,
          details: result.error,
        },
        { status: 502 }
      )
    }

    const voided = result.data.Payments?.[0]
    return ok({
      success: true,
      payment_id: voided?.PaymentID ?? payment_id,
      status: voided?.Status ?? 'DELETED',
    })
  } catch (err) {
    return errorResponse(err)
  }
}

async function notifyAdminsOfPaymentFailure(params: {
  jobId: string
  reference: string
  status: number
  retryable: boolean
  action: 'record' | 'void'
}): Promise<void> {
  await withServiceRole(async (tx) => {
    const admins = await tx
      .select({ userId: userRoles.userId })
      .from(userRoles)
      .where(eq(userRoles.role, 'admin'))
    if (admins.length === 0) return

    const link = `/admin/jobs/${params.jobId}`
    const verb = params.action === 'record' ? 'record' : 'void'
    const message =
      params.retryable && params.status === 0
        ? `Could not ${verb} Xero payment for ${params.reference} after retries (network error).`
        : `Xero ${verb} for ${params.reference} returned HTTP ${params.status} after retries.`

    await tx.insert(notifications).values(
      admins.map((a) => ({
        userId: a.userId,
        type: 'xero_payment_failed',
        title:
          params.action === 'record'
            ? 'Xero payment failed'
            : 'Xero payment void failed',
        message,
        link,
      }))
    )
  })
}
