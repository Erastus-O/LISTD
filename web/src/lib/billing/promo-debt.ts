import 'server-only'

import { and, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm'
import { jobs, withServiceRole } from '@/db'

/**
 * Deferred-payment (invoice_later promo) balances — 0035.
 *
 * A client's "monthly account balance" = quoted price of every
 * invoice-later job that hasn't been swept into a month-end invoice yet
 * (jobs.invoice_id NULL, same idempotency marker the escrow receipts use).
 * Cancelled jobs never owe. Invoiced-but-unpaid amounts live on the invoice
 * itself and show through the statement/invoices surfaces.
 */
export type DeferredBalance = {
  totalPounds: number
  jobCount: number
}

export async function loadClientDeferredBalance(
  clientUserId: string
): Promise<DeferredBalance> {
  try {
    const [row] = await withServiceRole((tx) =>
      tx
        .select({
          total: sql<string>`coalesce(sum(${jobs.quotedPrice}), 0)`,
          count: sql<number>`count(*)::int`,
        })
        .from(jobs)
        .where(
          and(
            eq(jobs.clientId, clientUserId),
            eq(jobs.promoKind, 'invoice_later'),
            isNull(jobs.invoiceId),
            notInArray(jobs.status, ['cancelled'])
          )
        )
        .then((r) => r)
    )
    return {
      totalPounds: Number(row?.total ?? 0),
      jobCount: row?.count ?? 0,
    }
  } catch {
    // Pre-migration (no promo columns yet): no balance to show.
    return { totalPounds: 0, jobCount: 0 }
  }
}

/**
 * A clerk/cleaner's month-end pay: payouts on invoice-later jobs they've
 * delivered (report submitted onwards) that haven't reached `paid`. These
 * jobs took no escrow at booking, so the payout is settled in the monthly
 * run instead of on QA release — this is the figure their dashboard shows
 * as "due at month end".
 */
export async function loadWorkerMonthEndDue(
  workerUserId: string
): Promise<DeferredBalance> {
  const DELIVERED = [
    'submitted',
    'reviewed',
    'signed',
    'completed',
  ] as const
  try {
    const [row] = await withServiceRole((tx) =>
      tx
        .select({
          total: sql<string>`coalesce(sum(
            case
              when ${jobs.clerkId} = ${workerUserId}
                then coalesce(nullif(${jobs.clerkFinalPayout}, '0'), ${jobs.clerkPayout})
              else coalesce(nullif(${jobs.cleanerFinalPayout}, '0'), ${jobs.cleanerPayout})
            end
          ), 0)`,
          count: sql<number>`count(*)::int`,
        })
        .from(jobs)
        .where(
          and(
            eq(jobs.promoKind, 'invoice_later'),
            sql`(${jobs.clerkId} = ${workerUserId} OR ${jobs.cleanerId} = ${workerUserId})`,
            inArray(jobs.status, [...DELIVERED])
          )
        )
        .then((r) => r)
    )
    return {
      totalPounds: Number(row?.total ?? 0),
      jobCount: row?.count ?? 0,
    }
  } catch {
    return { totalPounds: 0, jobCount: 0 }
  }
}
