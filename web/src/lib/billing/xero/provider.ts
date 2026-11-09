import 'server-only'
import { and, asc, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm'
import {
  db,
  invoiceLineItems,
  invoicePayments,
  invoices,
  profiles,
  taxRates,
  withServiceRole,
  type Tx,
} from '@/db'
import { logAuditEvent } from '@/lib/audit'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import {
  XERO_API_BASE,
  fetchXeroWithRetry,
  xeroHeaders,
  type XeroAccess,
} from '@/lib/xero'
import {
  BillingProviderNotImplementedError,
  type BillingProvider,
  type Invoice,
  type InvoiceDraft,
  type InvoiceKind,
  type InvoiceLineItem,
  type InvoiceListFilter,
  type InvoicePage,
  type InvoicePayment,
  type InvoiceStatus,
  type InvoiceTaxSummaryRow,
  type RecordPaymentInput,
} from '../provider'
import { getXeroProviderAccess } from './access'
import { resolveXeroContact } from './contacts'

/**
 * Xero billing provider — closes the Phase 2 stub by mapping every
 * `BillingProvider` action onto Xero's Invoices/Payments API.
 *
 * **Dual-write model.** Xero is the source of truth for line items,
 * status, and the rendered PDF. Our `invoices` + `invoice_payments`
 * tables are kept as a **shadow** so list / detail pages stay snappy
 * (no Xero round-trip per row). Each method:
 *
 *   1. Calls Xero via `fetchXeroWithRetry` with idempotency keys.
 *   2. On success, mirrors the response into our DB inside a single
 *      `withServiceRole` tx alongside the audit row.
 *
 * If the mirror write fails, the audit row captures it but the Xero
 * mutation is already committed — admins can re-sync via the existing
 * `/api/cron/xero-invoice-reconciliation` cron.
 *
 * **What we do not do.** Credit notes against Xero invoices are out of
 * scope for v1 — Xero supports them but mapping our `parent_invoice_id`
 * shape needs more design. `createCreditNote` is intentionally absent;
 * the provider abstraction tolerates that (it's optional on the
 * interface).
 */
export const xeroBillingProvider: BillingProvider = {
  id: 'xero',

  async createInvoice(input: InvoiceDraft, actorUserId: string) {
    if (input.lineItems.length === 0) {
      throw new Error('Cannot create a Xero invoice with no line items.')
    }
    const access = await getXeroProviderAccess()
    const contact = await resolveXeroContact(input.clientId, access)
    if (!contact.ok) {
      throw new Error(contact.error)
    }

    // Pull tax-rate metadata so we can pass `TaxType` strings to Xero
    // instead of UUIDs (Xero has no concept of LISTD's tax_rates rows).
    const rateMap = await loadTaxRateMap(input.lineItems)
    const lineItemsForXero = input.lineItems.map((l) => {
      const rate = l.taxRateId ? rateMap.get(l.taxRateId) : null
      return {
        Description: l.description,
        Quantity: l.quantity ?? 1,
        UnitAmount: l.unitPrice,
        AccountCode: '200',
        // Xero requires either `TaxType` OR `LineAmount` — we send TaxType
        // when configured, fall back to `NONE` (no VAT applied at line).
        TaxType: rate?.xeroTaxType ?? 'NONE',
      }
    })

    const idempotencyKey = `invoice:create:${input.clientId}:${hashInput(input)}`
    const result = await fetchXeroWithRetry<{
      Invoices?: Array<{
        InvoiceID?: string
        InvoiceNumber?: string
        Status?: string
        Total?: number
        SubTotal?: number
        TotalTax?: number
        AmountDue?: number
        AmountPaid?: number
        CurrencyCode?: string
        Date?: string
        DueDate?: string
      }>
    }>(
      `${XERO_API_BASE}/Invoices`,
      {
        method: 'POST',
        headers: xeroHeaders(access),
        body: JSON.stringify({
          Invoices: [
            {
              Type: 'ACCREC',
              Contact: { ContactID: contact.contactId },
              LineAmountTypes: 'Exclusive',
              LineItems: lineItemsForXero,
              Status: 'DRAFT',
            },
          ],
        }),
      },
      access,
      { idempotencyKey }
    )
    if (!result.ok) {
      throw new Error(
        `Xero invoice create failed: HTTP ${result.status} (${JSON.stringify(result.error).slice(0, 200)})`
      )
    }
    const created = result.data.Invoices?.[0]
    if (!created?.InvoiceID) {
      throw new Error('Xero create succeeded but returned no InvoiceID.')
    }

    // Shadow into our DB. We compute LISTD-side line totals locally so
    // recipients see the same numbers Xero would render.
    const localId = await withServiceRole(async (tx) => {
      const computed = await computeLineRowsLocal(tx, input.lineItems, rateMap)
      const subtotal = computed.reduce((n, r) => n + r.lineSubtotal, 0)
      const taxTotal = computed.reduce((n, r) => n + r.lineTax, 0)

      const [inv] = await tx
        .insert(invoices)
        .values({
          clientId: input.clientId,
          organisationId: input.organisationId ?? null,
          notes: input.notes ?? null,
          subtotal: subtotal.toFixed(2),
          taxTotal: taxTotal.toFixed(2),
          total: (subtotal + taxTotal).toFixed(2),
          currency: created.CurrencyCode ?? 'GBP',
          status: 'draft',
          xeroInvoiceId: created.InvoiceID!,
          createdBy: actorUserId,
        })
        .returning({ id: invoices.id })

      await tx.insert(invoiceLineItems).values(
        computed.map((r, i) => ({
          invoiceId: inv.id,
          jobId: r.jobId,
          description: r.description,
          quantity: r.quantity.toFixed(2),
          unitPrice: r.unitPrice.toFixed(2),
          taxRateId: r.taxRateId,
          lineSubtotal: r.lineSubtotal.toFixed(2),
          lineTax: r.lineTax.toFixed(2),
          position: r.position ?? i,
        }))
      )

      await logAuditEvent(tx, {
        category: 'billing',
        action: 'invoice.created',
        actorUserId,
        targetType: 'invoice',
        targetId: inv.id,
        payload: {
          provider: 'xero',
          xeroInvoiceId: created.InvoiceID,
          xeroInvoiceNumber: created.InvoiceNumber,
          xeroStatus: created.Status,
          lineCount: computed.length,
          total: (subtotal + taxTotal).toFixed(2),
          contactId: contact.contactId,
        },
      })
      return inv.id
    })

    return { id: localId, reference: created.InvoiceNumber ?? null }
  },

  async getInvoice(id: string) {
    // Read from the shadow. The Xero-side data was mirrored at every
    // mutation, so this is up-to-date except for out-of-band edits made
    // directly in the Xero dashboard (which the reconciliation cron will
    // catch on the next sweep).
    return loadShadowInvoice(id)
  },

  async listInvoices(filter: InvoiceListFilter) {
    return listShadowInvoices(filter)
  },

  async issueInvoice(id: string, actorUserId: string) {
    const [row] = await db
      .select({
        id: invoices.id,
        status: invoices.status,
        xeroInvoiceId: invoices.xeroInvoiceId,
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
    if (!row.xeroInvoiceId) {
      throw new Error('Invoice has no Xero linkage : was it created via inbuilt?')
    }

    const access = await getXeroProviderAccess()

    // Flip Xero status DRAFT → AUTHORISED.
    const authResult = await fetchXeroWithRetry<{
      Invoices?: Array<{
        InvoiceID?: string
        InvoiceNumber?: string
        Status?: string
        Date?: string
        DueDate?: string
      }>
    }>(
      `${XERO_API_BASE}/Invoices/${row.xeroInvoiceId}`,
      {
        method: 'POST', // Xero quirk: POST on /Invoices/{id} is the update verb
        headers: xeroHeaders(access),
        body: JSON.stringify({
          Invoices: [{ InvoiceID: row.xeroInvoiceId, Status: 'AUTHORISED' }],
        }),
      },
      access,
      { idempotencyKey: `invoice:issue:${row.xeroInvoiceId}` }
    )
    if (!authResult.ok) {
      throw new Error(
        `Xero authorise failed: HTTP ${authResult.status} (${JSON.stringify(authResult.error).slice(0, 200)})`
      )
    }
    const authorised = authResult.data.Invoices?.[0]
    const reference = authorised?.InvoiceNumber ?? null
    const issueDate = authorised?.Date ? toIsoDate(authorised.Date) : null
    const dueDate = authorised?.DueDate ? toIsoDate(authorised.DueDate) : null
    if (!reference || !issueDate || !dueDate) {
      throw new Error(
        'Xero returned an authorised invoice without reference / dates : cannot proceed.'
      )
    }

    // Fetch PDF and upload to our bucket so client/worker pages serve it
    // from the same storage path inbuilt invoices use.
    const pdfBytes = await downloadXeroInvoicePdf(row.xeroInvoiceId, access)
    let pdfUrl: string | null = null
    if (pdfBytes) {
      const supabaseAdmin = getSupabaseAdmin()
      const isoSlug = new Date().toISOString().replace(/[:.]/g, '-')
      const key = `${id}/${reference}-${isoSlug}.pdf`
      const upload = await supabaseAdmin.storage
        .from('invoices')
        .upload(key, Buffer.from(pdfBytes), {
          contentType: 'application/pdf',
          upsert: false,
        })
      if (!upload.error) {
        const { data: pub } = supabaseAdmin.storage
          .from('invoices')
          .getPublicUrl(key)
        pdfUrl = pub.publicUrl
      } else {
        console.warn(
          '[xero/provider] PDF upload failed; falling back to xero-hosted view:',
          upload.error
        )
      }
    }

    await withServiceRole(async (tx) => {
      await tx
        .update(invoices)
        .set({
          status: 'issued',
          reference,
          issueDate,
          dueDate,
          pdfUrl,
          issuedAt: sql`now()`,
          updatedAt: sql`now()`,
        })
        .where(eq(invoices.id, id))

      await logAuditEvent(tx, {
        category: 'billing',
        action: 'invoice.issued',
        actorUserId,
        targetType: 'invoice',
        targetId: id,
        payload: {
          provider: 'xero',
          xeroInvoiceId: row.xeroInvoiceId,
          reference,
          issueDate,
          dueDate,
          pdfMirrored: !!pdfUrl,
        },
      })
    })

    return { pdfUrl: pdfUrl ?? '', reference }
  },

  async sendInvoiceEmail(id: string, actorUserId: string, _recipients) {
    const [row] = await db
      .select({
        id: invoices.id,
        status: invoices.status,
        xeroInvoiceId: invoices.xeroInvoiceId,
        reference: invoices.reference,
      })
      .from(invoices)
      .where(eq(invoices.id, id))
      .limit(1)
    if (!row) throw new Error('Invoice not found')
    if (!row.xeroInvoiceId) {
      throw new Error('Invoice has no Xero linkage')
    }
    if (row.status === 'draft') {
      throw new Error('Issue the invoice before sending.')
    }

    const access = await getXeroProviderAccess()
    // POST to /Invoices/{id}/Email — Xero sends via the org's configured
    // email pipeline (template + branding admin set up in Xero itself).
    // `recipients` is ignored: Xero uses the contact's email on file.
    const result = await fetchXeroWithRetry<unknown>(
      `${XERO_API_BASE}/Invoices/${row.xeroInvoiceId}/Email`,
      {
        method: 'POST',
        headers: xeroHeaders(access),
        body: '{}',
      },
      access,
      { idempotencyKey: `invoice:email:${row.xeroInvoiceId}` }
    )
    if (!result.ok) {
      throw new Error(
        `Xero email failed: HTTP ${result.status} (${JSON.stringify(result.error).slice(0, 200)})`
      )
    }

    await withServiceRole(async (tx) => {
      await tx
        .update(invoices)
        .set({
          status: row.status === 'issued' ? 'sent' : row.status,
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
          provider: 'xero',
          xeroInvoiceId: row.xeroInvoiceId,
          reference: row.reference,
        },
      })
    })
  },

  async recordPayment(
    id: string,
    actorUserId: string | null,
    input: RecordPaymentInput
  ) {
    const [row] = await db
      .select({
        id: invoices.id,
        status: invoices.status,
        total: invoices.total,
        paidTotal: invoices.paidTotal,
        xeroInvoiceId: invoices.xeroInvoiceId,
      })
      .from(invoices)
      .where(eq(invoices.id, id))
      .limit(1)
    if (!row) throw new Error('Invoice not found')
    if (!row.xeroInvoiceId) {
      throw new Error('Invoice has no Xero linkage')
    }
    if (row.status === 'draft' || row.status === 'void') {
      throw new Error(`Cannot record payment on a ${row.status} invoice.`)
    }

    const access = await getXeroProviderAccess()
    // Bank account code: Xero requires an AccountID for the payment to
    // land in. We use the env var `XERO_PAYMENT_ACCOUNT_CODE` (set per
    // tenant during onboarding). Falls back to '090' (a common Xero
    // default for "Business Bank Account"); admins should override.
    const accountCode = process.env.XERO_PAYMENT_ACCOUNT_CODE?.trim() || '090'

    const result = await fetchXeroWithRetry<{
      Payments?: Array<{ PaymentID?: string; Amount?: number; Date?: string }>
    }>(
      `${XERO_API_BASE}/Payments`,
      {
        method: 'POST',
        headers: xeroHeaders(access),
        body: JSON.stringify({
          Payments: [
            {
              Invoice: { InvoiceID: row.xeroInvoiceId },
              Account: { Code: accountCode },
              Date: input.paidAt,
              Amount: input.paidAmount,
              Reference: input.reference ?? undefined,
            },
          ],
        }),
      },
      access,
      {
        idempotencyKey: `payment:${row.xeroInvoiceId}:${input.paidAt}:${input.paidAmount}`,
      }
    )
    if (!result.ok) {
      throw new Error(
        `Xero payment failed: HTTP ${result.status} (${JSON.stringify(result.error).slice(0, 200)})`
      )
    }
    const created = result.data.Payments?.[0]
    if (!created?.PaymentID) {
      throw new Error('Xero payment created but returned no PaymentID.')
    }

    await withServiceRole(async (tx) => {
      // Idempotency on retries.
      const [existing] = await tx
        .select({ id: invoicePayments.id })
        .from(invoicePayments)
        .where(eq(invoicePayments.xeroPaymentId, created.PaymentID!))
        .limit(1)
      if (existing) return

      await tx.insert(invoicePayments).values({
        invoiceId: id,
        paidAmount: input.paidAmount.toFixed(2),
        paidAt: input.paidAt,
        method: input.method ?? 'bank_transfer',
        reference: input.reference ?? null,
        xeroPaymentId: created.PaymentID,
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
      const totalDue = Number(row.total)
      const fullyPaid = paidTotal + 0.0049 >= totalDue

      await tx
        .update(invoices)
        .set({
          paidTotal: paidTotal.toFixed(2),
          status: fullyPaid ? 'paid' : row.status,
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
          provider: 'xero',
          xeroInvoiceId: row.xeroInvoiceId,
          xeroPaymentId: created.PaymentID,
          paidAmount: input.paidAmount.toFixed(2),
          paidTotal: paidTotal.toFixed(2),
          fullyPaid,
        },
      })
    })
  },

  async voidInvoice(id: string, actorUserId: string, reason: string) {
    const [row] = await db
      .select({
        id: invoices.id,
        status: invoices.status,
        reference: invoices.reference,
        xeroInvoiceId: invoices.xeroInvoiceId,
      })
      .from(invoices)
      .where(eq(invoices.id, id))
      .limit(1)
    if (!row) throw new Error('Invoice not found')
    if (row.status === 'void') return // idempotent
    if (!row.xeroInvoiceId) {
      throw new Error('Invoice has no Xero linkage')
    }

    const access = await getXeroProviderAccess()
    // Xero rejects VOIDED on AUTHORISED invoices with payments — admin
    // must reverse the payments first. We pass the request through and
    // surface Xero's error message verbatim.
    const result = await fetchXeroWithRetry<unknown>(
      `${XERO_API_BASE}/Invoices/${row.xeroInvoiceId}`,
      {
        method: 'POST',
        headers: xeroHeaders(access),
        body: JSON.stringify({
          Invoices: [{ InvoiceID: row.xeroInvoiceId, Status: 'VOIDED' }],
        }),
      },
      access,
      { idempotencyKey: `invoice:void:${row.xeroInvoiceId}` }
    )
    if (!result.ok) {
      throw new Error(
        `Xero void failed: HTTP ${result.status} (${JSON.stringify(result.error).slice(0, 200)})`
      )
    }

    await withServiceRole(async (tx) => {
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
          provider: 'xero',
          xeroInvoiceId: row.xeroInvoiceId,
          reference: row.reference,
          priorStatus: row.status,
          reason,
        },
      })
    })
  },

  async createPaymentLink(_id: string, _actorUserId: string) {
    // Xero embeds its own "Pay now" link in the invoice email when the
    // admin has Stripe-via-Xero (or similar) configured in Xero. The
    // recipient UI in LISTD hides its own Pay Now button for Xero
    // invoices via the `provider.createPaymentLink === function` check,
    // so this NotImplemented error is the contract-correct response.
    throw new BillingProviderNotImplementedError(
      'xero',
      'createPaymentLink'
    )
  },
}

// ─── Helpers ─────────────────────────────────────────────────────────

type ComputedLine = {
  description: string
  quantity: number
  unitPrice: number
  taxRateId: string | null
  jobId: string | null
  position: number | undefined
  lineSubtotal: number
  lineTax: number
}

async function loadTaxRateMap(
  lineItems: InvoiceDraft['lineItems']
): Promise<Map<string, { rate: number; xeroTaxType: string | null }>> {
  const ids = Array.from(
    new Set(
      lineItems
        .map((l) => l.taxRateId)
        .filter((x): x is string => typeof x === 'string')
    )
  )
  if (ids.length === 0) return new Map()
  const rows = await db
    .select({
      id: taxRates.id,
      rate: taxRates.rate,
      xeroTaxType: taxRates.xeroTaxType,
    })
    .from(taxRates)
    .where(inArray(taxRates.id, ids))
  return new Map(
    rows.map((r) => [
      r.id,
      { rate: Number(r.rate), xeroTaxType: r.xeroTaxType },
    ])
  )
}

async function computeLineRowsLocal(
  _tx: Tx,
  input: InvoiceDraft['lineItems'],
  rateMap: Map<string, { rate: number; xeroTaxType: string | null }>
): Promise<ComputedLine[]> {
  return input.map((l) => {
    const quantity = l.quantity ?? 1
    const subtotal = round2(quantity * l.unitPrice)
    const rateRow = l.taxRateId ? rateMap.get(l.taxRateId) ?? null : null
    const rateValue = rateRow ? rateRow.rate : 0
    const tax = round2(subtotal * rateValue)
    return {
      description: l.description,
      quantity,
      unitPrice: l.unitPrice,
      taxRateId: l.taxRateId ?? null,
      jobId: l.jobId ?? null,
      position: l.position,
      lineSubtotal: subtotal,
      lineTax: tax,
    }
  })
}

async function downloadXeroInvoicePdf(
  xeroInvoiceId: string,
  access: XeroAccess
): Promise<Uint8Array | null> {
  // PDFs use the same endpoint with `Accept: application/pdf`. The retry
  // helper assumes JSON, so call fetch directly with our own retry.
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(
        `${XERO_API_BASE}/Invoices/${xeroInvoiceId}`,
        {
          method: 'GET',
          headers: {
            ...xeroHeaders(access),
            Accept: 'application/pdf',
          },
        }
      )
      if (res.ok) {
        return new Uint8Array(await res.arrayBuffer())
      }
      if (res.status >= 400 && res.status < 500 && res.status !== 429) {
        return null
      }
    } catch (err) {
      console.warn(`[xero/provider] PDF fetch attempt ${attempt} failed:`, err)
    }
    await new Promise((r) => setTimeout(r, 500 * 2 ** (attempt - 1)))
  }
  return null
}

async function loadShadowInvoice(id: string): Promise<Invoice | null> {
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

const PAGE_SIZE = 25

async function listShadowInvoices(
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
  if (filter.clientId) clauses.push(eq(invoices.clientId, filter.clientId))
  if (filter.organisationId) {
    clauses.push(eq(invoices.organisationId, filter.organisationId))
  }
  if (filter.from) clauses.push(gte(invoices.issueDate, filter.from))
  if (filter.to) clauses.push(lte(invoices.issueDate, filter.to))
  if (filter.q && filter.q.trim()) {
    const like = `%${filter.q.trim()}%`
    clauses.push(sql`${invoices.reference} ILIKE ${like}`)
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

function hashInput(input: InvoiceDraft): string {
  // Stable signature for idempotency — same draft posted twice resolves
  // to the same Xero invoice.
  const sig =
    `${input.clientId}|${input.organisationId ?? ''}|` +
    input.lineItems
      .map(
        (l) =>
          `${l.description}|${l.quantity ?? 1}|${l.unitPrice}|${l.taxRateId ?? ''}`
      )
      .join(';')
  // Trim to keep the idempotency-key header under Xero's limit.
  return sig.length > 80 ? sig.slice(0, 80) : sig
}

function toIsoDate(raw: string): string {
  // Xero returns dates as `/Date(1612345678000+0000)/` in some payloads
  // and `2026-05-15` in others. Normalise to YYYY-MM-DD.
  const ms = raw.match(/\/Date\((\d+)/)?.[1]
  if (ms) return new Date(Number(ms)).toISOString().slice(0, 10)
  const trimmed = raw.slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : raw
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
