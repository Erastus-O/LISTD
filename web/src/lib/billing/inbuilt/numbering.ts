import 'server-only'
import { sql } from 'drizzle-orm'
import { creditNoteNumbering, invoiceNumbering, type Tx } from '@/db'

/**
 * Atomic per-year invoice-number allocator. Run inside the issue tx so a
 * crash between number-claim and `invoices.reference` update can't leak a
 * gap (the next attempt re-claims the unused number on retry).
 *
 * Postgres-side semantics: `INSERT … ON CONFLICT DO UPDATE … RETURNING`
 * is atomic per row, so two concurrent issues in the same year serialise
 * cleanly. Each call increments `next_number` by 1 and returns the value
 * that was just claimed (i.e. the one before the increment).
 *
 * Year resets per Docs/LISTD_Invoice_Generator_Plan.md §11 — counter
 * goes back to 1 on the first issue of January.
 */
export async function claimInvoiceNumber(
  tx: Tx,
  year: number
): Promise<{ year: number; number: number; reference: string }> {
  const [row] = await tx
    .insert(invoiceNumbering)
    .values({ year, nextNumber: 2 })
    .onConflictDoUpdate({
      target: invoiceNumbering.year,
      set: {
        nextNumber: sql`${invoiceNumbering.nextNumber} + 1`,
        updatedAt: sql`now()`,
      },
    })
    .returning({
      year: invoiceNumbering.year,
      nextNumber: invoiceNumbering.nextNumber,
    })

  // After the upsert, `nextNumber` holds the value to use NEXT time.
  // The number we just claimed is `nextNumber - 1`. The fresh-insert
  // branch sets nextNumber to 2, so the claimed number is 1.
  const claimed = row.nextNumber - 1
  return {
    year,
    number: claimed,
    reference: formatInvoiceReference(year, claimed),
  }
}

/**
 * Format an invoice reference for display. Five-digit zero-padded number:
 * INV-2026-00012. Stable enough to print on PDFs and reference verbally;
 * matches the LST-YYYY-NNNN job ref convention.
 */
export function formatInvoiceReference(year: number, number: number): string {
  return `INV-${year}-${String(number).padStart(5, '0')}`
}

/**
 * Credit-note variant of `claimInvoiceNumber`. Allocates CN-YYYY-NNNNN
 * references against `credit_note_numbering`. Two counters advance
 * independently so the invoice series isn't perturbed by credit-note
 * issuance (and vice-versa).
 */
export async function claimCreditNoteNumber(
  tx: Tx,
  year: number
): Promise<{ year: number; number: number; reference: string }> {
  const [row] = await tx
    .insert(creditNoteNumbering)
    .values({ year, nextNumber: 2 })
    .onConflictDoUpdate({
      target: creditNoteNumbering.year,
      set: {
        nextNumber: sql`${creditNoteNumbering.nextNumber} + 1`,
        updatedAt: sql`now()`,
      },
    })
    .returning({
      year: creditNoteNumbering.year,
      nextNumber: creditNoteNumbering.nextNumber,
    })

  const claimed = row.nextNumber - 1
  return {
    year,
    number: claimed,
    reference: formatCreditNoteReference(year, claimed),
  }
}

export function formatCreditNoteReference(
  year: number,
  number: number
): string {
  return `CN-${year}-${String(number).padStart(5, '0')}`
}
