import 'server-only'
import { and, asc, desc, eq, gte, inArray, lte, or, sql } from 'drizzle-orm'
import {
  db,
  invoiceLineItems,
  invoicePayments,
  invoices,
  notifications,
  platformSettings,
  profiles,
  taxRates,
  withServiceRole,
  type Tx,
} from '@/db'
import { logAuditEvent } from '@/lib/audit'
import { notifyUserSms } from '@/lib/notify-prefs'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { FROM_TRANSACTIONAL, getResend, logEmail } from '@/lib/resend'
import {
  BillingProviderNotImplementedError,
  type BillingProvider,
  type CreditNoteDraft,
  type Invoice,
  type InvoiceDraft,
  type InvoiceKind,
  type InvoiceLineItem,
  type InvoiceListFilter,
  type InvoicePage,
  type InvoicePayment,
  type InvoiceStatus,
  type InvoiceTaxSummaryRow,
  type PaymentLink,
  type RecordPaymentInput,
} from '../provider'
import { getSiteOrigin, getStripe, isStripeConfigured } from '../stripe'
import { claimCreditNoteNumber, claimInvoiceNumber } from './numbering'
import {
  renderInvoicePdf,
  type InvoicePdfCompanyInfo,
  type InvoicePdfLine,
} from './render-pdf'

const PAGE_SIZE = 25
const DEFAULT_DUE_DAYS = 30
const COMPANY_DETAILS_KEY = 'invoice_company_details'
const VAT_NUMBER_KEY = 'invoice_vat_registration_number'
const PAYMENT_INSTRUCTIONS_KEY = 'invoice_payment_instructions'

/**
 * Inbuilt billing provider — Phase 1 implementation backed by Drizzle.
 *
 * Every mutation runs inside `withServiceRole` so admin/system writes
 * bypass RLS deterministically; the route handlers that call into here
 * have already gated on `authorizeRequest('admin')`. Each lifecycle
 * action writes a `billing/invoice.<action>` audit row inside the same
 * tx as the mutation.
 *
 * The PDF render and email send happen outside the create/issue tx —
 * they're slow, occasionally fail, and shouldn't hold a Postgres
 * transaction open for the duration.
 */
export const inbuiltBillingProvider: BillingProvider = {
  id: 'inbuilt',

  async createInvoice(input: InvoiceDraft, actorUserId: string) {
    return withServiceRole(async (tx) => {
      const lineRows = await computeLineRows(tx, input.lineItems)
      const subtotal = lineRows.reduce((n, r) => n + r.lineSubtotal, 0)
      const taxTotal = lineRows.reduce((n, r) => n + r.lineTax, 0)

      const [inv] = await tx
        .insert(invoices)
        .values({
          clientId: input.clientId,
          organisationId: input.organisationId ?? null,
          notes: input.notes ?? null,
          subtotal: subtotal.toFixed(2),
          taxTotal: taxTotal.toFixed(2),
          total: (subtotal + taxTotal).toFixed(2),
          status: 'draft',
          createdBy: actorUserId,
        })
        .returning({ id: invoices.id })

      await insertLineItems(tx, inv.id, lineRows)

      await logAuditEvent(tx, {
        category: 'billing',
        action: 'invoice.created',
        actorUserId,
        targetType: 'invoice',
        targetId: inv.id,
        payload: {
          lineCount: lineRows.length,
          subtotal: subtotal.toFixed(2),
          taxTotal: taxTotal.toFixed(2),
          total: (subtotal + taxTotal).toFixed(2),
          clientId: input.clientId,
          organisationId: input.organisationId ?? null,
        },
      })

      return { id: inv.id, reference: null }
    })
  },

  async createCreditNote(input: CreditNoteDraft, actorUserId: string) {
    return withServiceRole(async (tx) => {
      const [parent] = await tx
        .select({
          id: invoices.id,
          status: invoices.status,
          kind: invoices.kind,
          clientId: invoices.clientId,
          organisationId: invoices.organisationId,
          currency: invoices.currency,
          reference: invoices.reference,
        })
        .from(invoices)
        .where(eq(invoices.id, input.parentInvoiceId))
        .limit(1)
      if (!parent) throw new Error('Parent invoice not found')
      if (parent.kind !== 'invoice') {
        throw new Error('A credit note can only offset a regular invoice.')
      }
      if (parent.status === 'draft') {
        throw new Error('Issue the parent invoice before crediting it.')
      }

      const lineRows = await computeLineRows(tx, input.lineItems)
      const subtotal = lineRows.reduce((n, r) => n + r.lineSubtotal, 0)
      const taxTotal = lineRows.reduce((n, r) => n + r.lineTax, 0)
      const combinedNotes = input.notes
        ? `Reason: ${input.reason}\n\n${input.notes}`
        : `Reason: ${input.reason}`

      const [cn] = await tx
        .insert(invoices)
        .values({
          kind: 'credit_note',
          parentInvoiceId: parent.id,
          clientId: parent.clientId,
          organisationId: parent.organisationId,
          currency: parent.currency,
          notes: combinedNotes,
          subtotal: subtotal.toFixed(2),
          taxTotal: taxTotal.toFixed(2),
          total: (subtotal + taxTotal).toFixed(2),
          status: 'draft',
          createdBy: actorUserId,
        })
        .returning({ id: invoices.id })

      await insertLineItems(tx, cn.id, lineRows)

      await logAuditEvent(tx, {
        category: 'billing',
        action: 'credit_note.created',
        actorUserId,
        targetType: 'invoice',
        targetId: cn.id,
        payload: {
          parentInvoiceId: parent.id,
          parentReference: parent.reference,
          reason: input.reason,
          lineCount: lineRows.length,
          subtotal: subtotal.toFixed(2),
          taxTotal: taxTotal.toFixed(2),
          total: (subtotal + taxTotal).toFixed(2),
        },
      })

      return { id: cn.id, reference: null }
    })
  },

  async getInvoice(id) {
    return loadInvoice(id)
  },

  async listInvoices(filter: InvoiceListFilter) {
    return listInvoicesImpl(filter)
  },

  async issueInvoice(id: string, actorUserId: string) {
    // Two-stage: snapshot + reference allocation in one tx, then PDF
    // render + upload + URL update in a second tx (PDF is slow).
    const issued = await withServiceRole(async (tx) => {
      const [row] = await tx
        .select({
          id: invoices.id,
          status: invoices.status,
          kind: invoices.kind,
          subtotal: invoices.subtotal,
          taxTotal: invoices.taxTotal,
          total: invoices.total,
        })
        .from(invoices)
        .where(eq(invoices.id, id))
        .limit(1)
      if (!row) throw new Error('Invoice not found')
      if (row.status !== 'draft') {
        throw new Error(
          `Cannot issue invoice in status '${row.status}'. Only drafts can be issued.`
        )
      }

      const year = new Date().getUTCFullYear()
      // Credit notes pull from the CN-YYYY-NNNNN counter; regular
      // invoices from INV-YYYY-NNNNN. Two parallel sequences avoid any
      // shared-counter coupling.
      const claim =
        row.kind === 'credit_note'
          ? await claimCreditNoteNumber(tx, year)
          : await claimInvoiceNumber(tx, year)

      const lineRowsRaw = await tx
        .select({
          unitPrice: invoiceLineItems.unitPrice,
          quantity: invoiceLineItems.quantity,
          taxRateId: invoiceLineItems.taxRateId,
          lineSubtotal: invoiceLineItems.lineSubtotal,
          lineTax: invoiceLineItems.lineTax,
        })
        .from(invoiceLineItems)
        .where(eq(invoiceLineItems.invoiceId, id))

      const rateIds = Array.from(
        new Set(
          lineRowsRaw
            .map((r) => r.taxRateId)
            .filter((x): x is string => Boolean(x))
        )
      )
      const rateRows =
        rateIds.length === 0
          ? []
          : await tx
              .select({
                id: taxRates.id,
                code: taxRates.code,
                rate: taxRates.rate,
              })
              .from(taxRates)
              .where(inArray(taxRates.id, rateIds))
      const rateMap = new Map(rateRows.map((r) => [r.id, r]))
      const taxSummary = aggregateTaxSummary(lineRowsRaw, rateMap)

      const today = new Date()
      const due = new Date(today)
      due.setUTCDate(due.getUTCDate() + DEFAULT_DUE_DAYS)
      const issueDateIso = today.toISOString().slice(0, 10)
      const dueDateIso = due.toISOString().slice(0, 10)

      await tx
        .update(invoices)
        .set({
          status: 'issued',
          reference: claim.reference,
          issueDate: issueDateIso,
          dueDate: dueDateIso,
          taxSummary,
          issuedAt: sql`now()`,
          updatedAt: sql`now()`,
        })
        .where(eq(invoices.id, id))

      await logAuditEvent(tx, {
        category: 'billing',
        action: row.kind === 'credit_note' ? 'credit_note.issued' : 'invoice.issued',
        actorUserId,
        targetType: 'invoice',
        targetId: id,
        payload: {
          kind: row.kind,
          reference: claim.reference,
          issueDate: issueDateIso,
          dueDate: dueDateIso,
          subtotal: row.subtotal,
          taxTotal: row.taxTotal,
          total: row.total,
          taxRows: taxSummary.length,
        },
      })

      return {
        reference: claim.reference,
        issueDate: issueDateIso,
        dueDate: dueDateIso,
      }
    })

    // Render + upload PDF outside the tx (slow).
    const pdfBytes = await renderPdfForInvoice(id)
    const supabaseAdmin = getSupabaseAdmin()
    const isoSlug = new Date().toISOString().replace(/[:.]/g, '-')
    const key = `${id}/${issued.reference}-${isoSlug}.pdf`
    const upload = await supabaseAdmin.storage
      .from('invoices')
      .upload(key, Buffer.from(pdfBytes), {
        contentType: 'application/pdf',
        upsert: false,
      })
    if (upload.error) {
      throw new Error(`Invoice PDF upload failed: ${upload.error.message}`)
    }
    const { data: pub } = supabaseAdmin.storage
      .from('invoices')
      .getPublicUrl(key)
    const pdfUrl = pub.publicUrl

    await withServiceRole(async (tx) => {
      await tx
        .update(invoices)
        .set({ pdfUrl, updatedAt: sql`now()` })
        .where(eq(invoices.id, id))
    })

    return { pdfUrl, reference: issued.reference }
  },

  async sendInvoiceEmail(id, actorUserId, recipients) {
    const inv = await loadInvoice(id)
    if (!inv) throw new Error('Invoice not found')
    if (inv.status === 'draft') {
      throw new Error('Issue the invoice before sending.')
    }
    if (!inv.pdfUrl) {
      throw new Error('Invoice has no PDF : re-issue to regenerate.')
    }

    const recipientEmails = recipients?.length
      ? recipients
      : await resolveRecipientEmails(inv.clientId)
    if (recipientEmails.length === 0) {
      throw new Error('No recipient email available.')
    }

    const subject = `Invoice ${inv.reference}`
    const html = renderInvoiceEmailHtml(inv)
    const pdfAttachment = await downloadPdfForAttachment(inv.pdfUrl)

    const { data, error } = await getResend().emails.send({
      from: FROM_TRANSACTIONAL,
      to: recipientEmails,
      subject,
      html,
      attachments: pdfAttachment
        ? [
            {
              filename: `${inv.reference}.pdf`,
              content: Buffer.from(pdfAttachment).toString('base64'),
            },
          ]
        : undefined,
    })

    await logEmail({
      functionName: 'send-invoice',
      recipientEmails,
      subject,
      resendId: data?.id ?? null,
      errorMessage: error ? error.message : null,
      metadata: { invoiceId: id, reference: inv.reference },
    })
    if (error) throw new Error(`Invoice email failed: ${error.message}`)

    await withServiceRole(async (tx) => {
      await tx
        .update(invoices)
        .set({
          status: inv.status === 'issued' ? 'sent' : inv.status,
          sentAt: sql`now()`,
          updatedAt: sql`now()`,
        })
        .where(eq(invoices.id, id))

      await logAuditEvent(tx, {
        category: 'billing',
        action: 'invoice.sent',
        actorUserId,
        targetType: 'invoice',
        targetId: id,
        payload: {
          reference: inv.reference,
          recipientCount: recipientEmails.length,
          attached: !!pdfAttachment,
        },
      })
    })
  },

  async recordPayment(id, actorUserId, input: RecordPaymentInput) {
    const outcome = await withServiceRole(async (tx) => {
      const [inv] = await tx
        .select({
          id: invoices.id,
          status: invoices.status,
          total: invoices.total,
          paidTotal: invoices.paidTotal,
          clientId: invoices.clientId,
          reference: invoices.reference,
          currency: invoices.currency,
        })
        .from(invoices)
        .where(eq(invoices.id, id))
        .limit(1)
      if (!inv) throw new Error('Invoice not found')
      if (inv.status === 'draft' || inv.status === 'void') {
        throw new Error(`Cannot record payment on a ${inv.status} invoice.`)
      }

      // Idempotency for Stripe webhook retries: skip if a row with this
      // checkout-session id already exists.
      if (input.stripeCheckoutSessionId) {
        const [existing] = await tx
          .select({ id: invoicePayments.id })
          .from(invoicePayments)
          .where(
            eq(
              invoicePayments.stripeCheckoutSessionId,
              input.stripeCheckoutSessionId
            )
          )
          .limit(1)
        if (existing) return { notify: null }
      }

      await tx.insert(invoicePayments).values({
        invoiceId: id,
        paidAmount: input.paidAmount.toFixed(2),
        paidAt: input.paidAt,
        method: input.method ?? 'bank_transfer',
        reference: input.reference ?? null,
        stripeCheckoutSessionId: input.stripeCheckoutSessionId ?? null,
        stripePaymentIntentId: input.stripePaymentIntentId ?? null,
        recordedBy: actorUserId,
        note: input.note ?? null,
      })

      const [agg] = await tx
        .select({
          paidTotal: sql<string>`coalesce(sum(${invoicePayments.paidAmount}), 0)`,
        })
        .from(invoicePayments)
        .where(eq(invoicePayments.invoiceId, id))
      const paidTotal = Number(agg?.paidTotal ?? 0)
      const totalDue = Number(inv.total)
      const fullyPaid = paidTotal + 0.0049 >= totalDue // fp tolerance

      await tx
        .update(invoices)
        .set({
          paidTotal: paidTotal.toFixed(2),
          status: fullyPaid ? 'paid' : inv.status,
          paidAt: fullyPaid ? sql`now()` : sql`${invoices.paidAt}`,
          updatedAt: sql`now()`,
        })
        .where(eq(invoices.id, id))

      await logAuditEvent(tx, {
        category: 'billing',
        action: fullyPaid ? 'invoice.paid' : 'invoice.payment_recorded',
        actorUserId,
        targetType: 'invoice',
        targetId: id,
        payload: {
          paidAmount: input.paidAmount.toFixed(2),
          paidTotal: paidTotal.toFixed(2),
          method: input.method ?? 'bank_transfer',
          fullyPaid,
          stripe: !!input.stripeCheckoutSessionId,
        },
      })

      // On full settlement, give the client an in-app notification +
      // carry an SMS payload out of the tx (fired post-commit so the
      // Twilio call never holds this connection open).
      if (fullyPaid && inv.clientId) {
        const ref = inv.reference ?? id.slice(0, 8)
        await tx.insert(notifications).values({
          userId: inv.clientId,
          type: 'payment',
          title: 'Payment received',
          message: `Payment received in full for invoice ${ref}. Thank you.`,
          link: `/client/invoices/${id}`,
        })
        return {
          notify: {
            clientId: inv.clientId,
            reference: ref,
            amount: paidTotal,
            currency: inv.currency,
          },
        }
      }
      return { notify: null }
    })

    if (outcome?.notify) {
      const { clientId, reference, amount, currency } = outcome.notify
      const money = `${currency === 'GBP' ? '£' : currency + ' '}${amount.toFixed(2)}`
      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://listd.pro'
      const smsBody = `LISTD: Payment of ${money} received for invoice ${reference}. Thank you. ${siteUrl}/client/invoices`
      await notifyUserSms(clientId, 'smsPaymentUpdates', smsBody)
    }
  },

  async voidInvoice(id, actorUserId, reason) {
    return withServiceRole(async (tx) => {
      const [inv] = await tx
        .select({
          id: invoices.id,
          status: invoices.status,
          reference: invoices.reference,
        })
        .from(invoices)
        .where(eq(invoices.id, id))
        .limit(1)
      if (!inv) throw new Error('Invoice not found')
      if (inv.status === 'void') return // idempotent

      await tx
        .update(invoices)
        .set({
          status: 'void',
          voidedAt: sql`now()`,
          voidReason: reason,
          updatedAt: sql`now()`,
        })
        .where(eq(invoices.id, id))

      await logAuditEvent(tx, {
        category: 'billing',
        action: 'invoice.voided',
        actorUserId,
        targetType: 'invoice',
        targetId: id,
        payload: {
          reference: inv.reference,
          priorStatus: inv.status,
          reason,
        },
      })
    })
  },

  async createPaymentLink(id: string, actorUserId: string): Promise<PaymentLink> {
    // Phase 6 — Stripe pay-by-link. Surfaces a hosted Checkout Session
    // for the unpaid balance. `metadata.invoiceId` is the breadcrumb the
    // webhook uses to route `checkout.session.completed` back into
    // `recordPayment`. The session id is duplicated into both
    // `client_reference_id` and `metadata` for belt-and-braces lookups.
    if (!isStripeConfigured()) {
      throw new BillingProviderNotImplementedError('inbuilt', 'createPaymentLink')
    }

    const inv = await loadInvoice(id)
    if (!inv) throw new Error('Invoice not found')
    if (inv.kind === 'credit_note') {
      throw new Error('Credit notes cannot be paid via Stripe : they reduce a balance.')
    }
    if (inv.status === 'draft') {
      throw new Error('Issue the invoice before generating a payment link.')
    }
    if (inv.status === 'void') {
      throw new Error('Voided invoices cannot be paid.')
    }
    const outstandingMinor = Math.round(
      (Number(inv.total) - Number(inv.paidTotal)) * 100
    )
    if (outstandingMinor <= 0) {
      throw new Error('Invoice is already paid in full.')
    }

    const stripe = await getStripe()
    const origin = getSiteOrigin()
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      currency: inv.currency.toLowerCase(),
      payment_method_types: ['card'],
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: inv.currency.toLowerCase(),
            unit_amount: outstandingMinor,
            product_data: {
              name: `Invoice ${inv.reference ?? id}`,
              description: inv.notes?.slice(0, 250) || undefined,
            },
          },
        },
      ],
      client_reference_id: inv.id,
      metadata: {
        invoiceId: inv.id,
        reference: inv.reference ?? '',
        actorUserId,
      },
      // After payment Stripe redirects back to the same invoice detail
      // page; the webhook is the source of truth for marking it paid,
      // not the redirect. Both URLs include `?stripe=success|cancelled`
      // so the page can surface a banner.
      success_url: `${origin}/client/invoices/${inv.id}?stripe=success`,
      cancel_url: `${origin}/client/invoices/${inv.id}?stripe=cancelled`,
    })

    if (!session.url) {
      throw new Error('Stripe did not return a checkout URL.')
    }

    // Audit the link creation. We don't write a payment row yet — that
    // happens on webhook receipt.
    await withServiceRole(async (tx) => {
      await logAuditEvent(tx, {
        category: 'billing',
        action: 'invoice.payment_link_created',
        actorUserId,
        targetType: 'invoice',
        targetId: inv.id,
        payload: {
          stripeSessionId: session.id,
          outstandingMinor,
          currency: inv.currency,
          reference: inv.reference,
        },
      })
    })

    return { checkoutUrl: session.url, sessionId: session.id }
  },
}

// ─── Implementation helpers ───────────────────────────────────────────

type ComputedLine = {
  description: string
  quantity: number
  unitPrice: number
  taxRateId: string | null
  jobId: string | null
  position: number
  lineSubtotal: number
  lineTax: number
  rateCode: string | null
  rateValue: number
}

async function computeLineRows(
  tx: Tx,
  input: InvoiceDraft['lineItems']
): Promise<ComputedLine[]> {
  const rateIds = Array.from(
    new Set(
      input
        .map((l) => l.taxRateId)
        .filter((id): id is string => typeof id === 'string')
    )
  )
  const rateRows =
    rateIds.length === 0
      ? []
      : await tx
          .select({
            id: taxRates.id,
            code: taxRates.code,
            rate: taxRates.rate,
          })
          .from(taxRates)
          .where(inArray(taxRates.id, rateIds))
  const rateMap = new Map(rateRows.map((r) => [r.id, r]))

  return input.map((l, i) => {
    const quantity = l.quantity ?? 1
    const subtotal = round2(quantity * l.unitPrice)
    const rateRow = l.taxRateId ? rateMap.get(l.taxRateId) ?? null : null
    const rateValue = rateRow ? Number(rateRow.rate) : 0
    const tax = round2(subtotal * rateValue)
    return {
      description: l.description,
      quantity,
      unitPrice: l.unitPrice,
      taxRateId: l.taxRateId ?? null,
      jobId: l.jobId ?? null,
      position: l.position ?? i,
      lineSubtotal: subtotal,
      lineTax: tax,
      rateCode: rateRow?.code ?? null,
      rateValue,
    }
  })
}

async function insertLineItems(
  tx: Tx,
  invoiceId: string,
  rows: ComputedLine[]
): Promise<void> {
  if (rows.length === 0) return
  await tx.insert(invoiceLineItems).values(
    rows.map((r) => ({
      invoiceId,
      jobId: r.jobId,
      description: r.description,
      quantity: r.quantity.toFixed(2),
      unitPrice: r.unitPrice.toFixed(2),
      taxRateId: r.taxRateId,
      lineSubtotal: r.lineSubtotal.toFixed(2),
      lineTax: r.lineTax.toFixed(2),
      position: r.position,
    }))
  )
}

function aggregateTaxSummary(
  rows: Array<{
    lineSubtotal: string
    lineTax: string
    taxRateId: string | null
  }>,
  rateMap: Map<string, { id: string; code: string; rate: string }>
): InvoiceTaxSummaryRow[] {
  const grouped = new Map<
    string,
    {
      rateId: string | null
      code: string
      rate: number
      base: number
      tax: number
    }
  >()
  for (const r of rows) {
    const rateRow = r.taxRateId ? rateMap.get(r.taxRateId) ?? null : null
    const rate = rateRow ? Number(rateRow.rate) : 0
    const key = rateRow ? rateRow.id : 'untaxed'
    const acc = grouped.get(key) ?? {
      rateId: rateRow?.id ?? null,
      code: rateRow?.code ?? 'untaxed',
      rate,
      base: 0,
      tax: 0,
    }
    acc.base += Number(r.lineSubtotal)
    acc.tax += Number(r.lineTax)
    grouped.set(key, acc)
  }
  return Array.from(grouped.values()).map((g) => ({
    rateId: g.rateId,
    code: g.code,
    rate: g.rate,
    base: round2(g.base),
    tax: round2(g.tax),
  }))
}

async function loadInvoice(id: string): Promise<Invoice | null> {
  const [head] = await db
    .select()
    .from(invoices)
    .where(eq(invoices.id, id))
    .limit(1)
  if (!head) return null
  const lineRows = await db
    .select()
    .from(invoiceLineItems)
    .where(eq(invoiceLineItems.invoiceId, id))
    .orderBy(asc(invoiceLineItems.position))
  const paymentRows = await db
    .select()
    .from(invoicePayments)
    .where(eq(invoicePayments.invoiceId, id))
    .orderBy(desc(invoicePayments.paidAt))

  return {
    id: head.id,
    reference: head.reference,
    status: head.status as InvoiceStatus,
    kind: head.kind as InvoiceKind,
    parentInvoiceId: head.parentInvoiceId,
    clientId: head.clientId,
    organisationId: head.organisationId,
    issueDate: head.issueDate,
    dueDate: head.dueDate,
    subtotal: head.subtotal,
    taxTotal: head.taxTotal,
    total: head.total,
    paidTotal: head.paidTotal,
    currency: head.currency,
    notes: head.notes,
    taxSummary: parseTaxSummary(head.taxSummary),
    pdfUrl: head.pdfUrl,
    issuedAt: head.issuedAt,
    sentAt: head.sentAt,
    paidAt: head.paidAt,
    voidedAt: head.voidedAt,
    voidReason: head.voidReason,
    lineItems: lineRows.map(
      (r): InvoiceLineItem => ({
        id: r.id,
        jobId: r.jobId,
        description: r.description,
        quantity: r.quantity,
        unitPrice: r.unitPrice,
        taxRateId: r.taxRateId,
        lineSubtotal: r.lineSubtotal,
        lineTax: r.lineTax,
        position: r.position,
      })
    ),
    payments: paymentRows.map(
      (p): InvoicePayment => ({
        id: p.id,
        paidAmount: p.paidAmount,
        paidAt: p.paidAt,
        method: p.method,
        reference: p.reference,
        recordedBy: p.recordedBy,
        note: p.note,
        createdAt: p.createdAt,
      })
    ),
    createdAt: head.createdAt,
    updatedAt: head.updatedAt,
  }
}

async function listInvoicesImpl(
  filter: InvoiceListFilter
): Promise<InvoicePage> {
  const page = Math.max(0, filter.page ?? 0)
  const offset = page * PAGE_SIZE

  const clauses = []
  if (filter.status && filter.status !== 'all') {
    clauses.push(eq(invoices.status, filter.status))
  }
  if (filter.kind && filter.kind !== 'all') {
    clauses.push(eq(invoices.kind, filter.kind))
  }
  if (filter.clientId) {
    clauses.push(eq(invoices.clientId, filter.clientId))
  }
  if (filter.organisationId) {
    clauses.push(eq(invoices.organisationId, filter.organisationId))
  }
  if (filter.from) clauses.push(gte(invoices.issueDate, filter.from))
  if (filter.to) clauses.push(lte(invoices.issueDate, filter.to))
  if (filter.q && filter.q.trim()) {
    const like = `%${filter.q.trim()}%`
    const search = or(sql`${invoices.reference} ILIKE ${like}`)
    if (search) clauses.push(search)
  }
  const where = clauses.length === 0 ? undefined : and(...clauses)

  const rows = await db
    .select({
      id: invoices.id,
      reference: invoices.reference,
      status: invoices.status,
      kind: invoices.kind,
      parentInvoiceId: invoices.parentInvoiceId,
      issueDate: invoices.issueDate,
      dueDate: invoices.dueDate,
      total: invoices.total,
      paidTotal: invoices.paidTotal,
      currency: invoices.currency,
      clientId: invoices.clientId,
      organisationId: invoices.organisationId,
      recipientName: profiles.fullName,
    })
    .from(invoices)
    .leftJoin(profiles, eq(profiles.userId, invoices.clientId))
    .where(where)
    .orderBy(desc(invoices.issueDate), desc(invoices.createdAt))
    .limit(PAGE_SIZE)
    .offset(offset)

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(invoices)
    .where(where)

  return {
    rows: rows.map((r) => ({
      id: r.id,
      reference: r.reference,
      status: r.status as InvoiceStatus,
      kind: r.kind as InvoiceKind,
      parentInvoiceId: r.parentInvoiceId,
      issueDate: r.issueDate,
      dueDate: r.dueDate,
      total: r.total,
      paidTotal: r.paidTotal,
      currency: r.currency,
      clientId: r.clientId,
      organisationId: r.organisationId,
      recipientName: r.recipientName,
    })),
    total: count ?? 0,
    page,
    pageSize: PAGE_SIZE,
  }
}

async function renderPdfForInvoice(id: string): Promise<Uint8Array> {
  const inv = await loadInvoice(id)
  if (!inv) throw new Error('Invoice not found for PDF render')
  if (!inv.reference || !inv.issueDate || !inv.dueDate) {
    throw new Error('Invoice missing reference/issue date : issue first')
  }

  const [company, vatNumber, paymentInstructions, recipient, parentRef] =
    await Promise.all([
      loadCompanyDetails(),
      loadPlatformString(VAT_NUMBER_KEY),
      loadPlatformString(PAYMENT_INSTRUCTIONS_KEY),
      loadRecipient(inv.clientId),
      inv.kind === 'credit_note' && inv.parentInvoiceId
        ? loadInvoiceReference(inv.parentInvoiceId)
        : Promise.resolve(null),
    ])

  const rateIds = Array.from(
    new Set(
      inv.lineItems
        .map((l) => l.taxRateId)
        .filter((x): x is string => Boolean(x))
    )
  )
  const rateRows =
    rateIds.length === 0
      ? []
      : await db
          .select({
            id: taxRates.id,
            code: taxRates.code,
            name: taxRates.name,
            rate: taxRates.rate,
          })
          .from(taxRates)
          .where(inArray(taxRates.id, rateIds))
  const rateMap = new Map(rateRows.map((r) => [r.id, r]))

  const lines: InvoicePdfLine[] = inv.lineItems.map((l) => {
    const rate = l.taxRateId ? rateMap.get(l.taxRateId) ?? null : null
    const taxRate = rate ? Number(rate.rate) : 0
    return {
      description: l.description,
      quantity: Number(l.quantity),
      unitPrice: Number(l.unitPrice),
      taxRateLabel: rate ? `${(taxRate * 100).toFixed(0)}%` : '—',
      taxRate,
      lineSubtotal: Number(l.lineSubtotal),
      lineTax: Number(l.lineTax),
    }
  })

  return renderInvoicePdf({
    reference: inv.reference,
    issueDate: inv.issueDate,
    dueDate: inv.dueDate,
    recipient,
    company: { ...company, vatNumber: vatNumber || null },
    lines,
    totals: {
      subtotal: Number(inv.subtotal),
      taxSummary: inv.taxSummary.map((t) => ({
        label: rateMap.get(t.rateId ?? '')?.name ?? t.code,
        base: t.base,
        tax: t.tax,
        rate: t.rate,
      })),
      total: Number(inv.total),
      currency: inv.currency,
    },
    notes: inv.notes,
    paymentInstructions: paymentInstructions || null,
    kind: inv.kind,
    parentReference: parentRef,
  })
}

async function loadInvoiceReference(id: string): Promise<string | null> {
  const [row] = await db
    .select({ reference: invoices.reference })
    .from(invoices)
    .where(eq(invoices.id, id))
    .limit(1)
  return row?.reference ?? null
}

async function loadCompanyDetails(): Promise<InvoicePdfCompanyInfo> {
  const raw = await loadPlatformJson(COMPANY_DETAILS_KEY)
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>
    const name = typeof obj.name === 'string' ? obj.name : 'LISTD Pro'
    const address = typeof obj.address === 'string' ? obj.address : ''
    const contact = typeof obj.contact === 'string' ? obj.contact : null
    return {
      name,
      addressLines: address.split(/\r?\n/).filter(Boolean).slice(0, 4),
      contact,
      vatNumber: null,
    }
  }
  return {
    name: 'LISTD Pro',
    addressLines: ['Set company details in /admin/settings/tax'],
    contact: null,
    vatNumber: null,
  }
}

async function loadPlatformString(key: string): Promise<string | null> {
  const [row] = await db
    .select({ value: platformSettings.value })
    .from(platformSettings)
    .where(eq(platformSettings.key, key))
    .limit(1)
  return row?.value ?? null
}

async function loadPlatformJson(key: string): Promise<unknown> {
  const raw = await loadPlatformString(key)
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

async function loadRecipient(clientId: string) {
  const [profile] = await db
    .select({
      fullName: profiles.fullName,
      companyName: profiles.companyName,
    })
    .from(profiles)
    .where(eq(profiles.userId, clientId))
    .limit(1)
  let email: string | null = null
  try {
    const res = await getSupabaseAdmin().auth.admin.getUserById(clientId)
    email = res.data?.user?.email ?? null
  } catch {
    email = null
  }
  return {
    fullName: profile?.fullName ?? null,
    companyName: profile?.companyName ?? null,
    email,
  }
}

async function resolveRecipientEmails(clientId: string): Promise<string[]> {
  try {
    const res = await getSupabaseAdmin().auth.admin.getUserById(clientId)
    return res.data?.user?.email ? [res.data.user.email] : []
  } catch {
    return []
  }
}

async function downloadPdfForAttachment(
  url: string
): Promise<Uint8Array | null> {
  try {
    const supabaseAdmin = getSupabaseAdmin()
    const parsed = new URL(url)
    const match = parsed.pathname.match(
      /\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/]+)\/(.+)$/
    )
    if (match) {
      const { data } = await supabaseAdmin.storage
        .from(match[1])
        .download(decodeURIComponent(match[2]))
      if (data) return new Uint8Array(await data.arrayBuffer())
    }
    const res = await fetch(url)
    if (!res.ok) return null
    return new Uint8Array(await res.arrayBuffer())
  } catch {
    return null
  }
}

function renderInvoiceEmailHtml(inv: Invoice): string {
  const ref = inv.reference ?? '(unreferenced)'
  const due = inv.dueDate ?? '(no due date)'
  const total = new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: inv.currency,
  }).format(Number(inv.total))
  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;padding:32px 20px;">
      <h1 style="font-size:22px;margin:0 0 12px;">Invoice ${ref}</h1>
      <p style="font-size:14px;color:#555;line-height:1.5;">
        Hi : please find your invoice attached. The total of <strong>${total}</strong>
        is due by <strong>${due}</strong>.
      </p>
      <p style="font-size:13px;color:#777;line-height:1.5;">
        If you have any questions, just reply to this email and we'll get back to you.
      </p>
      <p style="font-size:11px;color:#999;margin-top:24px;">Generated by LISTD Pro.</p>
    </div>
  `.trim()
}

function parseTaxSummary(raw: unknown): InvoiceTaxSummaryRow[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
    .map((r) => ({
      rateId: typeof r.rateId === 'string' ? r.rateId : null,
      code: typeof r.code === 'string' ? r.code : 'untaxed',
      rate: typeof r.rate === 'number' ? r.rate : 0,
      base: typeof r.base === 'number' ? r.base : 0,
      tax: typeof r.tax === 'number' ? r.tax : 0,
    }))
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
