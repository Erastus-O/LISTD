import 'server-only'
import { alias } from 'drizzle-orm/pg-core'
import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import { db, escrowTransactions, invoices, jobs, profiles } from '@/db'
import type { InvoiceKind, InvoiceStatus } from './provider'

/**
 * Statement of account loader (Phase 8 — polish).
 *
 * Pulls every non-draft, non-void invoice + credit note for a client and
 * returns:
 *
 *   - `rows`         — one entry per document, sorted by issue date asc.
 *                      Credit notes carry a negative `total` so a running
 *                      sum yields the net balance owed.
 *   - `ageing`       — 0-30 / 31-60 / 61-90 / 90+ day buckets keyed on
 *                      `due_date`. Each bucket sums the OUTSTANDING amount
 *                      (total - paidTotal). Credit notes contribute as
 *                      "current" (they reduce what's owed immediately).
 *   - `netOutstanding` — sum of invoice outstanding − sum of credit-note
 *                      remaining. Negative means the client is in credit.
 *
 * Used by both `/admin/clients/[clientId]/statement` and `/client/statement`.
 * Drafts and voids are excluded — they aren't "real" debts.
 */

export type StatementRow = {
  id: string
  kind: InvoiceKind
  reference: string | null
  status: InvoiceStatus
  issueDate: string | null
  dueDate: string | null
  /** Always positive. */
  total: string
  /** Always positive. Always 0 for credit notes (not applicable). */
  paidTotal: string
  /** Signed: positive for invoices, negative for credit notes. */
  signedTotal: number
  /** Signed remaining balance to settle. */
  signedOutstanding: number
  currency: string
  parentReference: string | null
}

/** A job the client paid for at booking (escrow settled) that hasn't been
 *  invoiced/receipted yet — receipts are issued after QA approval, so without
 *  these rows the statement lags real spend by the whole job lifecycle. */
export type PrepaidRow = {
  jobId: string
  reference: string
  inspectionType: string
  paidAt: string | null
  amount: number
}

export type AgeingBuckets = {
  current: number
  days30: number
  days60: number
  days90: number
  days90plus: number
}

export type ClientStatement = {
  client: {
    userId: string
    fullName: string | null
    companyName: string | null
  }
  /** ISO YYYY-MM-DD the statement was generated. */
  asOf: string
  rows: StatementRow[]
  /** Escrow-paid jobs awaiting their receipt invoice. */
  prepaidRows: PrepaidRow[]
  prepaidTotal: number
  /** Money actually paid: invoice payments + escrow prepayments. This is the
   *  figure that should track the dashboard's spend. */
  totalPaid: number
  ageing: AgeingBuckets
  /** Sum of `signedOutstanding` across all rows. Positive = client owes. */
  netOutstanding: number
  /** Mostly informational — the currency of the first row. We don't render
   *  a multi-currency statement; if a client somehow has mixed currencies
   *  the totals row reads "see lines". */
  currency: string
}

export async function loadClientStatement(
  clientId: string
): Promise<ClientStatement | null> {
  const [client] = await db
    .select({
      userId: profiles.userId,
      fullName: profiles.fullName,
      companyName: profiles.companyName,
    })
    .from(profiles)
    .where(eq(profiles.userId, clientId))
    .limit(1)
  if (!client) return null

  const parent = alias(invoices, 'parent')
  const rows = await db
    .select({
      id: invoices.id,
      kind: invoices.kind,
      reference: invoices.reference,
      status: invoices.status,
      issueDate: invoices.issueDate,
      dueDate: invoices.dueDate,
      total: invoices.total,
      paidTotal: invoices.paidTotal,
      currency: invoices.currency,
      parentReference: parent.reference,
    })
    .from(invoices)
    .leftJoin(parent, eq(parent.id, invoices.parentInvoiceId))
    .where(
      and(
        eq(invoices.clientId, clientId),
        inArray(invoices.status, ['issued', 'sent', 'paid', 'overdue'])
      )
    )
    .orderBy(asc(invoices.issueDate), asc(invoices.createdAt))

  // Settled escrow payments (client already paid at booking) whose receipt
  // invoice hasn't been issued yet — issued only after QA approval, so mid-
  // lifecycle jobs would otherwise be invisible on the statement despite the
  // money having left the client's account. Defensive .catch: pre-0027 DBs
  // have no escrow table.
  const prepaidRaw = await db
    .select({
      jobId: escrowTransactions.jobId,
      gross: escrowTransactions.grossAmount,
      heldAt: escrowTransactions.heldAt,
      inspectionType: jobs.inspectionType,
    })
    .from(escrowTransactions)
    .innerJoin(jobs, eq(jobs.id, escrowTransactions.jobId))
    .where(
      and(
        eq(escrowTransactions.clientUserId, clientId),
        inArray(escrowTransactions.status, ['held', 'released']),
        isNull(jobs.invoiceId)
      )
    )
    .orderBy(asc(escrowTransactions.heldAt))
    .then((r) => r)
    .catch(() => [])

  const prepaidRows: PrepaidRow[] = prepaidRaw.map((p) => ({
    jobId: p.jobId,
    reference: p.jobId.slice(0, 8),
    inspectionType: p.inspectionType,
    paidAt: p.heldAt ? p.heldAt.slice(0, 10) : null,
    amount: round2(p.gross / 100),
  }))
  const prepaidTotal = round2(
    prepaidRows.reduce((sum, p) => sum + p.amount, 0)
  )

  const today = new Date()
  const ageing: AgeingBuckets = {
    current: 0,
    days30: 0,
    days60: 0,
    days90: 0,
    days90plus: 0,
  }
  let netOutstanding = 0

  const statementRows: StatementRow[] = rows.map((r) => {
    const isCN = r.kind === 'credit_note'
    const totalNum = Number(r.total)
    const paidNum = Number(r.paidTotal)
    const signedTotal = isCN ? -totalNum : totalNum
    // For credit notes the "outstanding" is the unredeemed credit — for
    // simplicity we treat the whole CN as outstanding credit until a
    // future reconciliation feature applies it against a specific
    // invoice. So signedOutstanding = -total.
    const signedOutstanding = isCN
      ? -totalNum
      : Math.max(0, totalNum - paidNum)

    netOutstanding += signedOutstanding

    if (signedOutstanding !== 0) {
      bucketAge(ageing, signedOutstanding, r.dueDate, today, isCN)
    }

    return {
      id: r.id,
      kind: r.kind as InvoiceKind,
      reference: r.reference,
      status: r.status as InvoiceStatus,
      issueDate: r.issueDate,
      dueDate: r.dueDate,
      total: r.total,
      paidTotal: r.paidTotal,
      signedTotal: round2(signedTotal),
      signedOutstanding: round2(signedOutstanding),
      currency: r.currency,
      parentReference: r.parentReference,
    }
  })

  // Money actually paid: invoice payments (credit notes excluded) + escrow
  // prepayments awaiting their receipt.
  const invoicePaid = statementRows.reduce(
    (sum, r) => (r.kind === 'credit_note' ? sum : sum + Number(r.paidTotal)),
    0
  )

  return {
    client,
    asOf: today.toISOString().slice(0, 10),
    rows: statementRows,
    prepaidRows,
    prepaidTotal,
    totalPaid: round2(invoicePaid + prepaidTotal),
    ageing: {
      current: round2(ageing.current),
      days30: round2(ageing.days30),
      days60: round2(ageing.days60),
      days90: round2(ageing.days90),
      days90plus: round2(ageing.days90plus),
    },
    netOutstanding: round2(netOutstanding),
    currency: rows[0]?.currency ?? 'GBP',
  }
}

function bucketAge(
  buckets: AgeingBuckets,
  amount: number,
  dueDateIso: string | null,
  today: Date,
  isCreditNote: boolean
): void {
  // Credit notes are "available credit" — they bucket as current.
  if (isCreditNote || !dueDateIso) {
    buckets.current += amount
    return
  }
  const due = new Date(dueDateIso)
  const days = Math.floor((today.getTime() - due.getTime()) / 86_400_000)
  if (days <= 0) buckets.current += amount
  else if (days <= 30) buckets.days30 += amount
  else if (days <= 60) buckets.days60 += amount
  else if (days <= 90) buckets.days90 += amount
  else buckets.days90plus += amount
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
