import 'server-only'

/**
 * Billing provider interface — the single seam between LISTD's invoice
 * surfaces and whichever backend is currently active. Selected via
 * `platform_settings.invoice_provider` ∈ {'inbuilt', 'xero'}.
 *
 * Both Phase 0 implementations (inbuilt + Xero stub) implement the same
 * shape so admin / client pages don't branch on provider. Toggling is a
 * one-row platform_settings edit; no rebuild.
 *
 * See Docs/LISTD_Invoice_Generator_Plan.md §2 for the architectural
 * rationale.
 */

export type BillingProviderId = 'inbuilt' | 'xero'

export type InvoiceStatus =
  | 'draft'
  | 'issued'
  | 'sent'
  | 'paid'
  | 'overdue'
  | 'void'

/**
 * `kind` discriminates the document type. Credit notes share the
 * invoices table but always point at a parent invoice and allocate
 * references from a parallel CN-YYYY-NNNNN counter.
 */
export type InvoiceKind = 'invoice' | 'credit_note'

export type InvoiceLineItemDraft = {
  /** Free-text description rendered on the PDF. */
  description: string
  /** Default 1. Decimal-friendly (numeric type in DB). */
  quantity?: number
  /** Pre-tax unit price. */
  unitPrice: number
  /** Optional FK to `tax_rates.id`. When null, the line is zero-rated. */
  taxRateId?: string | null
  /** Optional FK to `jobs.id` if this line came from an inspection. */
  jobId?: string | null
  /** Render order (defaults to insertion order). */
  position?: number
}

export type InvoiceDraft = {
  clientId: string
  organisationId?: string | null
  /** Free-text on the PDF (payment terms, internal references, etc). */
  notes?: string | null
  /** Days from issue date to due date. Defaults to 30. Per-invoice
   *  override of the company-wide default in platform_settings. */
  dueInDays?: number
  lineItems: InvoiceLineItemDraft[]
}

/**
 * Credit-note draft. A subset of `InvoiceDraft` — recipient is inherited
 * from the parent invoice, and the `reason` is appended to the PDF notes
 * block + captured in the audit trail.
 */
export type CreditNoteDraft = {
  parentInvoiceId: string
  /** Human-readable reason printed on the PDF + recorded in the audit row. */
  reason: string
  /** Optional extra free-text appended below the reason. */
  notes?: string | null
  lineItems: InvoiceLineItemDraft[]
}

export type InvoiceTaxSummaryRow = {
  rateId: string | null
  code: string
  rate: number
  base: number
  tax: number
}

export type InvoiceLineItem = {
  id: string
  jobId: string | null
  description: string
  quantity: string
  unitPrice: string
  taxRateId: string | null
  lineSubtotal: string
  lineTax: string
  position: number
}

export type InvoicePayment = {
  id: string
  paidAmount: string
  paidAt: string
  method: string
  reference: string | null
  recordedBy: string | null
  note: string | null
  createdAt: string
}

export type Invoice = {
  id: string
  reference: string | null
  status: InvoiceStatus
  kind: InvoiceKind
  /** Set when `kind === 'credit_note'` — references the offsetting invoice. */
  parentInvoiceId: string | null
  clientId: string
  organisationId: string | null
  issueDate: string | null
  dueDate: string | null
  subtotal: string
  taxTotal: string
  total: string
  paidTotal: string
  currency: string
  notes: string | null
  taxSummary: InvoiceTaxSummaryRow[]
  pdfUrl: string | null
  issuedAt: string | null
  sentAt: string | null
  paidAt: string | null
  voidedAt: string | null
  voidReason: string | null
  lineItems: InvoiceLineItem[]
  payments: InvoicePayment[]
  createdAt: string
  updatedAt: string
}

export type InvoiceListFilter = {
  status?: InvoiceStatus | 'all'
  /** Default `'all'` shows invoices + credit notes mixed. */
  kind?: InvoiceKind | 'all'
  clientId?: string
  organisationId?: string
  /** Inclusive YYYY-MM-DD bounds. */
  from?: string
  to?: string
  /** Free-text search across reference + client name. */
  q?: string
  page?: number
}

export type InvoicePage = {
  rows: Array<
    Pick<
      Invoice,
      | 'id'
      | 'reference'
      | 'status'
      | 'kind'
      | 'parentInvoiceId'
      | 'issueDate'
      | 'dueDate'
      | 'total'
      | 'paidTotal'
      | 'currency'
      | 'clientId'
      | 'organisationId'
    > & { recipientName: string | null }
  >
  total: number
  page: number
  pageSize: number
}

export type PaymentMethod =
  | 'bank_transfer'
  | 'card'
  | 'cash'
  | 'stripe'
  | 'other'

export type RecordPaymentInput = {
  paidAmount: number
  paidAt: string
  method?: PaymentMethod
  reference?: string | null
  note?: string | null
  /** Stripe Checkout session id — set by the webhook handler when the
   *  payment came in via the hosted-checkout flow. Lets retries locate
   *  the payment row idempotently. */
  stripeCheckoutSessionId?: string | null
  stripePaymentIntentId?: string | null
}

export type PaymentLink = {
  /** Hosted Stripe Checkout URL — client redirects browser to this. */
  checkoutUrl: string
  /** Returned for forensic + idempotency purposes. */
  sessionId: string
}

/**
 * Single surface every consumer talks to. Implementations:
 *   - `src/lib/billing/inbuilt/provider.ts` — first-party (Phase 1+)
 *   - `src/lib/billing/xero/provider.ts`    — Xero (Phase 0 stub)
 *
 * Every implementation runs server-side. Implementations are expected to
 * call into `withServiceRole` / `logAuditEvent` themselves — the
 * interface stays storage-agnostic.
 */
export interface BillingProvider {
  readonly id: BillingProviderId

  /** Create a draft invoice. Returns the new id + (provisional) reference
   *  if the provider allocates one at draft time. The inbuilt provider
   *  leaves reference null until issue; Xero may issue immediately. */
  createInvoice(
    input: InvoiceDraft,
    actorUserId: string
  ): Promise<{ id: string; reference: string | null }>

  /** Create a draft credit note offsetting an existing invoice.
   *  Recipient (clientId + organisationId + currency) inherits from the
   *  parent; line items can mirror the parent or be a custom partial
   *  list. Returns the new draft's id — issue + send are routed through
   *  the same `issueInvoice` / `sendInvoiceEmail` calls. */
  createCreditNote?(
    input: CreditNoteDraft,
    actorUserId: string
  ): Promise<{ id: string; reference: string | null }>

  /** Fetch the full invoice (header + line items + payments) by id. */
  getInvoice(id: string): Promise<Invoice | null>

  /** Paginated list, filterable by status/recipient/date range/search. */
  listInvoices(filter: InvoiceListFilter): Promise<InvoicePage>

  /** Lock the invoice, allocate a reference, snapshot tax, render PDF. */
  issueInvoice(
    id: string,
    actorUserId: string
  ): Promise<{ pdfUrl: string; reference: string }>

  /** Email the PDF to the recipient(s). Idempotent — re-sending is allowed. */
  sendInvoiceEmail(
    id: string,
    actorUserId: string,
    recipients?: string[]
  ): Promise<void>

  /** Record a payment (partial or full). Flips status to 'paid' on full.
   *  `actorUserId` may be `null` for system-originated payments — e.g. the
   *  Stripe webhook handler records payments from an event, not a logged-in
   *  user. The audit row will reflect the system actor in that case. */
  recordPayment(
    id: string,
    actorUserId: string | null,
    input: RecordPaymentInput
  ): Promise<void>

  /** Mark void with a required reason. Idempotent on already-void. */
  voidInvoice(
    id: string,
    actorUserId: string,
    reason: string
  ): Promise<void>

  /**
   * Create a Stripe Checkout session for the unpaid balance on `id` and
   * return its hosted-checkout URL. Optional on the interface because
   * Xero invoices carry their own payment link in the Xero-sent email
   * — only the inbuilt provider implements this.
   *
   * Page-handler callers should check `typeof provider.createPaymentLink
   * === 'function'` before invoking and conditionally render the "Pay
   * now" button.
   */
  createPaymentLink?(
    id: string,
    actorUserId: string
  ): Promise<PaymentLink>
}

/**
 * Thrown by the Xero stub (and any future provider) when a method isn't
 * implemented. Page handlers should catch and surface a friendly
 * "provider not yet wired" message rather than 500ing.
 */
export class BillingProviderNotImplementedError extends Error {
  readonly providerId: BillingProviderId
  readonly method: string
  constructor(providerId: BillingProviderId, method: string) {
    super(
      `Billing provider '${providerId}' does not yet implement '${method}'.`
    )
    this.providerId = providerId
    this.method = method
    this.name = 'BillingProviderNotImplementedError'
  }
}
