import 'server-only'
import { randomUUID } from 'node:crypto'
import { jobs, tenantDetails, type Tx } from '@/db'
import { logAuditEvent } from '@/lib/audit'
import type { BookingPlan } from './booking-plan'
import type { Pricing, ServiceKey } from './pricing'
import { issueQuote } from './quotes'
import type { BookingScope, ServicePlan } from './services'

export { planBooking } from './booking-plan'
export type { BookingPlan, BookingRequest } from './booking-plan'

export type CreatedJob = { jobId: string; plan: ServicePlan }

/**
 * Create one job per service, linked by a group id when there are several. Each
 * keeps its own quote, payment, Pro and report.
 *   pay + payment required  -> draft (published by the Stripe webhook)
 *   pay + no payment needed -> published
 *   quote                   -> pending, waiting for LISTD
 */
export async function createBookingJobs(
  tx: Tx,
  pr: Pricing,
  p: {
    plan: BookingPlan
    propertyId: string
    clientId: string
    createdByUserId: string
    organisationId: string | null
    scheduledDate: string
    scheduledTimeSlot?: string | null
    specialInstructions?: string | null
    scope?: BookingScope
    requirePayment: boolean
    tenants?: Array<{ fullName?: string | null; email?: string | null; phone?: string | null }>
    promo?: { id: string; kind: string; discountsPence?: Map<ServiceKey, number> } | null
    ip?: string | null
    ua?: string | null
  }
): Promise<CreatedJob[]> {
  const groupId = p.plan.plans.length > 1 ? randomUUID() : null
  const created: CreatedJob[] = []

  for (const plan of p.plan.plans) {
    const discP = p.promo?.discountsPence?.get(plan.service) ?? 0
    const totalP = Math.max(0, plan.totalP - discP)
    const status = plan.mode === 'quote' ? 'pending' : p.requirePayment ? 'draft' : 'published'
    const isClean = plan.service === 'CLEANING'
    const feePounds = plan.proFeeP != null ? (plan.proFeeP / 100).toString() : '0'
    const [job] = await tx
      .insert(jobs)
      .values({
        propertyId: p.propertyId,
        clientId: p.clientId,
        createdByUserId: p.createdByUserId,
        organisationId: p.organisationId,
        inspectionType: plan.inspectionType,
        inspectionTypes: [plan.inspectionType],
        scheduledDate: p.scheduledDate,
        preferredTimeSlot: p.scheduledTimeSlot ?? null,
        status,
        serviceTier: p.plan.sched,
        sched: p.plan.sched,
        groupId,
        scope: { ...(p.scope ?? {}), ...(p.plan.sameVisit && plan.service !== 'CLEANING' && plan.service !== 'REPAIRS_DAMAGES' ? { sameVisit: true } : {}) },
        proBase: plan.proBase,
        requiredLevel: plan.requiredLevel,
        specialInstructions: p.specialInstructions ?? null,
        quotedPrice: plan.mode === 'pay' ? (totalP / 100).toString() : null,
        shortNoticeSurchargeApplied: p.plan.sched === 'priority',
        promoCodeId: p.promo?.id ?? null,
        promoKind: p.promo?.kind ?? null,
        promoDiscount: discP > 0 ? (discP / 100).toString() : null,
        ...(isClean ? { cleanerPayout: feePounds } : { clerkPayout: feePounds }),
      })
      .returning({ id: jobs.id })

    // Fixed prices become an accepted v1 quote: the record behind the receipt.
    if (plan.mode === 'pay') {
      const q = await issueQuote(tx, pr, {
        jobId: job.id,
        lines: plan.lines,
        proFeeP: plan.proBase ? null : plan.proFeeP,
        durationMin: plan.durationMin,
        discP,
        actorId: null,
        auto: true,
        status: 'ACCEPTED',
      })
      if (!q.ok && totalP > 0) throw new Error(q.error)
    }

    let order = 1
    const tenants = (p.tenants ?? [])
      .filter((t) => t.fullName?.trim() || t.email?.trim() || t.phone?.trim())
      .map((t) => ({ jobId: job.id, fullName: t.fullName || null, email: t.email || null, phone: t.phone || null, tenantOrder: order++ }))
    if (tenants.length) await tx.insert(tenantDetails).values(tenants)

    await logAuditEvent(tx, {
      category: 'job_lifecycle',
      action: 'job.created',
      actorUserId: p.createdByUserId,
      targetType: 'job',
      targetId: job.id,
      payload: {
        service: plan.service,
        inspectionType: plan.inspectionType,
        mode: plan.mode,
        sched: p.plan.sched,
        groupId,
        totalP,
        requiredLevel: plan.requiredLevel,
      },
      ipAddress: p.ip ?? undefined,
      userAgent: p.ua ?? undefined,
    })
    created.push({ jobId: job.id, plan: { ...plan, totalP } })
  }
  return created
}
