import 'server-only'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { clientRebates, jobQuotes, jobs, type Tx } from '@/db'
import { portfolioSummary, type Pricing, type QuoteLine } from './pricing'

/** A client's completed jobs in a month, and the rebate they've earned. */
export async function clientPortfolio(tx: Tx, pr: Pricing, clientId: string, month: string) {
  const rows = await tx
    .select({
      lines: jobQuotes.lines,
      subP: jobQuotes.subP,
      clerkPayout: jobs.clerkPayout,
      cleanerPayout: jobs.cleanerPayout,
      inspectionType: jobs.inspectionType,
    })
    .from(jobs)
    .innerJoin(jobQuotes, and(eq(jobQuotes.jobId, jobs.id), eq(jobQuotes.status, 'ACCEPTED')))
    .where(
      and(
        eq(jobs.clientId, clientId),
        inArray(jobs.status, ['completed', 'paid']),
        sql`to_char(${jobs.approvedAt} at time zone 'Europe/London', 'YYYY-MM') = ${month}`
      )
    )
  const summary = portfolioSummary(
    pr,
    rows.map((r) => ({
      lines: r.lines as QuoteLine[],
      revP: r.subP,
      proP: Math.round(Number((r.inspectionType.startsWith('clean_') ? r.cleanerPayout : r.clerkPayout) ?? 0) * 100),
    }))
  )
  const [recorded] = await tx
    .select({ amountP: clientRebates.amountP })
    .from(clientRebates)
    .where(and(eq(clientRebates.clientId, clientId), eq(clientRebates.month, month)))
    .limit(1)
  return { month, ...summary, recordedP: recorded?.amountP ?? 0 }
}
