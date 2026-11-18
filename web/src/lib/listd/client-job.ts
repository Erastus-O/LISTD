import 'server-only'
import { eq } from 'drizzle-orm'
import { changeOrders, jobs, properties, withServiceRole } from '@/db'
import type { QuoteLine, ServiceKey } from './pricing'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { getPricing } from './pricing-settings'
import { currentQuote } from './quotes'
import { planService, serviceFromType, toPricedProperty, type BookingScope } from './services'

/** What the client's action panel needs. The caller has already checked access. */
export async function loadClientJobActions(jobId: string) {
  return withServiceRole(async (tx) => {
    const [job] = await tx.select({ dueAt: jobs.clientReviewDueAt }).from(jobs).where(eq(jobs.id, jobId)).limit(1)
    const q = await currentQuote(tx, jobId)
    const cos = await tx
      .select({ id: changeOrders.id, description: changeOrders.description, totalP: changeOrders.totalP, creditP: changeOrders.creditP, status: changeOrders.status, evidencePaths: changeOrders.evidencePaths })
      .from(changeOrders)
      .where(eq(changeOrders.jobId, jobId))
    const withEvidence = await Promise.all(
      cos.map(async ({ evidencePaths, ...c }) => ({ ...c, evidence: await signEvidence(evidencePaths) }))
    )
    return {
      reviewDueAt: job?.dueAt ?? null,
      quote: q
        ? { version: q.version, lines: q.lines as QuoteLine[], discP: q.discP, taxP: q.taxP, bookingFeeP: q.totalP - q.taxP - Math.max(0, q.subP - q.discP), totalP: q.totalP, why: q.why, expiresAt: q.expiresAt, exclusions: q.exclusions }
        : null,
      changeOrders: withEvidence,
    }
  })
}

const VIDEO = /\.(mp4|mov|webm|m4v|3gp)$/i

/** Short-lived links to requote photos and videos in the private job-photos bucket. */
export async function signEvidence(paths: unknown): Promise<Array<{ url: string; video: boolean }>> {
  const list = Array.isArray(paths) ? paths.filter((p): p is string => typeof p === 'string') : []
  if (!list.length) return []
  const { data } = await getSupabaseAdmin().storage.from('job-photos').createSignedUrls(list, 3600)
  return (data ?? []).flatMap((d) => (d.signedUrl ? [{ url: d.signedUrl, video: VIDEO.test(d.path ?? '') }] : []))
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
    const rawCos = await tx
      .select({ id: changeOrders.id, description: changeOrders.description, estimateP: changeOrders.estimateP, status: changeOrders.status, totalP: changeOrders.totalP, proFeeP: changeOrders.proFeeP, evidencePaths: changeOrders.evidencePaths })
      .from(changeOrders)
      .where(eq(changeOrders.jobId, jobId))
    const cos = await Promise.all(rawCos.map(async ({ evidencePaths, ...c }) => ({ ...c, evidence: await signEvidence(evidencePaths) })))
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
