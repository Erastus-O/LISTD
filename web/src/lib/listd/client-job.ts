import 'server-only'
import { eq } from 'drizzle-orm'
import { changeOrders, jobs, properties, withServiceRole } from '@/db'
import type { QuoteLine, ServiceKey } from './pricing'
import { getPricing } from './pricing-settings'
import { currentQuote } from './quotes'
import { planService, serviceFromType, toPricedProperty, type BookingScope } from './services'

/** What the client's action panel needs. The caller has already checked access. */
export async function loadClientJobActions(jobId: string) {
  return withServiceRole(async (tx) => {
    const [job] = await tx.select({ dueAt: jobs.clientReviewDueAt }).from(jobs).where(eq(jobs.id, jobId)).limit(1)
    const q = await currentQuote(tx, jobId)
    const cos = await tx
      .select({ id: changeOrders.id, description: changeOrders.description, totalP: changeOrders.totalP, creditP: changeOrders.creditP, status: changeOrders.status })
      .from(changeOrders)
      .where(eq(changeOrders.jobId, jobId))
    return {
      reviewDueAt: job?.dueAt ?? null,
      quote: q
        ? { version: q.version, lines: q.lines as QuoteLine[], totalP: q.totalP, why: q.why, expiresAt: q.expiresAt, exclusions: q.exclusions }
        : null,
      changeOrders: cos,
    }
  })
}

/** The admin quote builder: prefilled from the rate card, so LISTD starts from the same figures. */
export async function loadAdminQuotePanel(jobId: string) {
  const pricing = await getPricing()
  return withServiceRole(async (tx) => {
    const [row] = await tx
      .select({ job: jobs, property: properties })
      .from(jobs)
      .leftJoin(properties, eq(properties.id, jobs.propertyId))
      .where(eq(jobs.id, jobId))
      .limit(1)
    const q = await currentQuote(tx, jobId)
    const cos = await tx
      .select({ id: changeOrders.id, description: changeOrders.description, estimateP: changeOrders.estimateP, status: changeOrders.status, totalP: changeOrders.totalP })
      .from(changeOrders)
      .where(eq(changeOrders.jobId, jobId))
    let suggested: QuoteLine[] = []
    let defaultProFeeP: number | null = null
    if (row?.property) {
      const service: ServiceKey = serviceFromType(row.job.inspectionType)
      const plan = planService(pricing, service, toPricedProperty(row.property), {
        sched: row.job.sched === 'priority' ? 'priority' : 'standard',
        sameVisit: Boolean((row.job.scope as { sameVisit?: boolean } | null)?.sameVisit),
        scope: row.job.scope as BookingScope,
      })
      suggested = plan.lines
      defaultProFeeP = plan.proFeeP
    }
    return {
      pricing,
      suggested,
      defaultProFeeP,
      current: q ? { version: q.version, status: q.status, totalP: q.totalP, issuedAt: q.issuedAt, why: q.why } : null,
      changeOrders: cos,
    }
  })
}
