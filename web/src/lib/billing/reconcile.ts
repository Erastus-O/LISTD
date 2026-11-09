import 'server-only'
import { and, eq, gt, inArray, sql } from 'drizzle-orm'
import { db, invoices, profiles } from '@/db'

/**
 * Bank reconciliation helpers (Phase 8 — polish).
 *
 * Parse a CSV of credit rows from a UK bank export, then propose matches
 * against outstanding invoices. The matcher uses two signals:
 *
 *   1. **Reference match** — the invoice's `reference` string appears
 *      (case-insensitive) in the row's description. Highest confidence.
 *   2. **Amount match** — the row's amount equals the outstanding balance
 *      on exactly ONE outstanding invoice. Medium confidence — admin
 *      should sanity-check before confirming.
 *
 * No-match rows are surfaced so the admin can manually pick or skip.
 * Multi-currency is intentionally out of scope — we assume the bank
 * statement matches `invoices.currency` (GBP in v1).
 */

export type CsvRow = {
  /** Row index in the source file (1-based, excluding header). */
  index: number
  date: string | null
  description: string
  /** Positive for credits (money in). */
  amount: number
  /** Optional reference column, if the bank provides one separately. */
  reference: string | null
}

export type MatchedRow = {
  row: CsvRow
  /** Best candidate invoice if any. */
  match: {
    invoiceId: string
    reference: string | null
    clientName: string
    total: number
    outstanding: number
    confidence: 'reference' | 'amount' | 'none'
  } | null
}

/**
 * Parse a CSV string into structured rows. Recognises common UK bank
 * column orderings:
 *
 *   - Generic 4-col: Date, Description, Amount, Reference?
 *   - Lloyds:      Transaction Date, Transaction Type, Sort Code, Account
 *                  Number, Transaction Description, Debit Amount, Credit
 *                  Amount, Balance
 *   - Barclays:    Number, Date, Account, Amount, Subcategory, Memo
 *   - HSBC:        Date, Description, Amount
 *
 * The header is matched fuzzily (lowercase, strip punctuation) so admins
 * don't need to re-shape exports. Negative amounts (debits) are filtered
 * out — we only reconcile money in.
 */
export function parseBankCsv(raw: string): CsvRow[] {
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0)
  if (lines.length === 0) return []

  const header = parseCsvLine(lines[0]).map(normaliseHeader)
  const ix = mapColumns(header)
  if (ix.amount < 0 && ix.creditAmount < 0) {
    throw new Error(
      "CSV has no amount or credit column. Expected one of: 'amount', 'credit amount', 'paid in'."
    )
  }

  const out: CsvRow[] = []
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i])
    const description =
      (ix.description >= 0 ? cells[ix.description] : '') ??
      (ix.memo >= 0 ? cells[ix.memo] : '') ??
      ''
    const date = ix.date >= 0 ? cells[ix.date] : null
    const reference = ix.reference >= 0 ? cells[ix.reference] : null

    let amount = NaN
    if (ix.creditAmount >= 0 && cells[ix.creditAmount]) {
      amount = parseAmount(cells[ix.creditAmount])
    } else if (ix.amount >= 0 && cells[ix.amount]) {
      amount = parseAmount(cells[ix.amount])
    }
    if (!Number.isFinite(amount) || amount <= 0) continue

    out.push({
      index: i,
      date: normaliseDate(date),
      description: description.trim(),
      amount: Math.round(amount * 100) / 100,
      reference: reference?.trim() || null,
    })
  }
  return out
}

/**
 * Match each parsed row against the outstanding invoice pool. Returns
 * rows in the same order as the input, each tagged with its best match
 * (or `null`). Reference match wins over amount match.
 */
export async function matchRowsToInvoices(
  rows: CsvRow[]
): Promise<MatchedRow[]> {
  // Pull every outstanding invoice (issued/sent/overdue) and its
  // recipient name in one round-trip. Capped at 1000 since real-world
  // outstanding pools rarely exceed that.
  const outstandingRows = await db
    .select({
      id: invoices.id,
      reference: invoices.reference,
      total: invoices.total,
      paidTotal: invoices.paidTotal,
      kind: invoices.kind,
      clientFullName: profiles.fullName,
      clientCompany: profiles.companyName,
    })
    .from(invoices)
    .leftJoin(profiles, eq(profiles.userId, invoices.clientId))
    .where(
      and(
        inArray(invoices.status, ['issued', 'sent', 'overdue']),
        eq(invoices.kind, 'invoice'),
        gt(sql`${invoices.total} - ${invoices.paidTotal}`, '0')
      )
    )
    .limit(1000)

  const pool = outstandingRows.map((r) => ({
    id: r.id,
    reference: r.reference,
    total: Number(r.total),
    outstanding: Math.max(0, Number(r.total) - Number(r.paidTotal)),
    clientName: r.clientCompany ?? r.clientFullName ?? '(no name)',
  }))

  return rows.map((row): MatchedRow => {
    // 1. Reference match — invoice ref appears in description (or reference col).
    const haystack = `${row.description} ${row.reference ?? ''}`.toLowerCase()
    const byRef = pool.find(
      (p) =>
        p.reference !== null && haystack.includes(p.reference.toLowerCase())
    )
    if (byRef) {
      return {
        row,
        match: {
          invoiceId: byRef.id,
          reference: byRef.reference,
          clientName: byRef.clientName,
          total: byRef.total,
          outstanding: byRef.outstanding,
          confidence: 'reference',
        },
      }
    }

    // 2. Amount match — exactly one outstanding invoice matches penny-perfect.
    const sameAmount = pool.filter(
      (p) => Math.abs(p.outstanding - row.amount) < 0.005
    )
    if (sameAmount.length === 1) {
      const m = sameAmount[0]
      return {
        row,
        match: {
          invoiceId: m.id,
          reference: m.reference,
          clientName: m.clientName,
          total: m.total,
          outstanding: m.outstanding,
          confidence: 'amount',
        },
      }
    }

    return { row, match: null }
  })
}

// ── CSV plumbing ─────────────────────────────────────────────────────

function parseCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        cur += c
      }
    } else {
      if (c === ',') {
        out.push(cur)
        cur = ''
      } else if (c === '"') {
        inQuotes = true
      } else {
        cur += c
      }
    }
  }
  out.push(cur)
  return out.map((s) => s.trim())
}

function normaliseHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z]/g, '')
}

type ColMap = {
  date: number
  description: number
  memo: number
  amount: number
  creditAmount: number
  reference: number
}

function mapColumns(header: string[]): ColMap {
  const find = (...candidates: string[]): number => {
    for (const c of candidates) {
      const idx = header.indexOf(c)
      if (idx >= 0) return idx
    }
    return -1
  }
  return {
    date: find('date', 'transactiondate', 'postdate'),
    description: find(
      'description',
      'transactiondescription',
      'narrative',
      'details'
    ),
    memo: find('memo', 'subcategory'),
    amount: find('amount', 'value'),
    creditAmount: find('creditamount', 'paidin', 'credit', 'moneyin'),
    reference: find('reference', 'ref'),
  }
}

function parseAmount(s: string): number {
  // Strip currency symbols and thousand separators.
  const clean = s.replace(/[£,$€]/g, '').replace(/,/g, '').trim()
  if (!clean) return NaN
  return Number.parseFloat(clean)
}

function normaliseDate(raw: string | null): string | null {
  if (!raw) return null
  const trimmed = raw.trim()
  // ISO YYYY-MM-DD.
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed
  // UK DD/MM/YYYY.
  const uk = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (uk) {
    const [, d, m, y] = uk
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  }
  return null
}
