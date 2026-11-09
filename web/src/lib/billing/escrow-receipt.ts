import 'server-only'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { escrowTransactions, jobs, properties, withServiceRole } from '@/db'
import {
  INSPECTION_TYPE_LABELS,
  cleaningLabelFromType,
  type InspectionType,
} from '@/lib/pricing-matrix'
import { getBillingProvider } from './select'

/**
 * Issue a paid invoice + email the client a receipt for an escrow job, called
 * after the report is approved.
 *
 * The client already paid the full price into escrow at booking, so this is a
 * *receipt*, not a request for payment: we create the invoice, issue it, record
 * the escrow payment against it (flipping it to `paid`), then email it.
 *
 * Idempotent + best-effort: it no-throws and skips if the job was already
 * invoiced (`jobs.last_invoice_id`) or if there's no settled escrow to receipt.
 * A failure here must never block the QA approval, so the caller runs it
 * post-commit and ignores the result beyond logging.
 */
export async function issueEscrowReceiptForJob(
  jobId: string,
  actorUserId: string
): Promise<{ issued: boolean; reason?: string; invoiceId?: string }> {
  try {
    const [job] = await withServiceRole((tx) =>
      tx
        .select({
          clientId: jobs.clientId,
          organisationId: jobs.organisationId,
          inspectionType: jobs.inspectionType,
          invoiceId: jobs.invoiceId,
          propAddress: properties.addressLine1,
          propPostcode: properties.postcode,
        })
        .from(jobs)
        .leftJoin(properties, eq(properties.id, jobs.propertyId))
        .where(eq(jobs.id, jobId))
        .limit(1)
    )
    if (!job) return { issued: false, reason: 'job_not_found' }
    if (job.invoiceId) {
      return { issued: false, reason: 'already_invoiced' }
    }
    if (!job.clientId) return { issued: false, reason: 'no_client' }

    // Only receipt a job whose client payment actually settled into escrow.
    const [escrow] = await withServiceRole((tx) =>
      tx
        .select({
          grossAmount: escrowTransactions.grossAmount,
          stripeChargeId: escrowTransactions.stripeChargeId,
          stripePaymentIntent: escrowTransactions.stripePaymentIntent,
        })
        .from(escrowTransactions)
        .where(
          and(
            eq(escrowTransactions.jobId, jobId),
            inArray(escrowTransactions.status, ['held', 'released'])
          )
        )
        .limit(1)
    )
    if (!escrow) return { issued: false, reason: 'no_settled_escrow' }
    const gross = escrow.grossAmount / 100 // pence → pounds

    // Cleaning jobs aren't in INSPECTION_TYPE_LABELS — derive a clean label
    // (handles admin-defined offerings via the humanised fallback).
    const label =
      cleaningLabelFromType(job.inspectionType) ??
      INSPECTION_TYPE_LABELS[job.inspectionType as InspectionType] ??
      job.inspectionType
    const address = [job.propAddress, job.propPostcode]
      .filter(Boolean)
      .join(', ')
    const description = address ? `${label} — ${address}` : label

    const provider = await getBillingProvider()

    // 1. Draft a single-line invoice for the amount the client paid. Left
    //    zero-rated so total === amount paid (the escrow charge was the full
    //    quoted price; this is a receipt, not a re-quote).
    const draft = await provider.createInvoice(
      {
        clientId: job.clientId,
        organisationId: job.organisationId ?? null,
        notes: 'Paid in advance via card at booking. This is your receipt.',
        lineItems: [{ description, unitPrice: gross, quantity: 1, jobId }],
      },
      actorUserId
    )

    // 2. Issue (allocate reference + render PDF).
    await provider.issueInvoice(draft.id, actorUserId)

    // 3. Record the escrow payment → flips status to 'paid'.
    await provider.recordPayment(draft.id, actorUserId, {
      paidAmount: gross,
      paidAt: new Date().toISOString().slice(0, 10),
      method: 'stripe',
      reference: escrow.stripeChargeId,
      stripePaymentIntentId: escrow.stripePaymentIntent,
      note: 'Paid via escrow at booking',
    })

    // 4. Link the invoice to the job (also the idempotency guard) before the
    //    email, so a send failure can't cause a duplicate invoice on retry.
    await withServiceRole((tx) =>
      tx
        .update(jobs)
        .set({ invoiceId: draft.id, updatedAt: sql`now()` })
        .where(eq(jobs.id, jobId))
    )

    // 5. Email the paid invoice to the client as their receipt.
    await provider.sendInvoiceEmail(draft.id, actorUserId)

    return { issued: true, invoiceId: draft.id }
  } catch (err) {
    console.error('[escrow-receipt] issue failed for job', jobId, err)
    return {
      issued: false,
      reason: err instanceof Error ? err.message : 'error',
    }
  }
}
