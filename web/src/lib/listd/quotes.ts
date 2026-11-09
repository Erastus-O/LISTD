import 'server-only'
import { and, desc, eq, inArray, lte, sql } from 'drizzle-orm'
import { changeOrders, jobQuotes, jobs, notifications, withServiceRole, type Tx } from '@/db'
import { logAuditEvent } from '@/lib/audit'
import { linesTotal, quoteTotals, repairProFee, type Pricing, type QuoteLine } from './pricing'

/**
 * Versioned quotes. A job in `pending` is waiting for LISTD to price it (cleaning,
 * fixed repairs, custom sizes). Accepting moves it to `draft`, awaiting payment.
 * Once paid there is no updated quote: extra work goes through a change order.
 */

const BEFORE_PAYMENT = ['pending', 'draft']
const ref = (id: string) => id.slice(0, 8)

export async function currentQuote(tx: Tx, jobId: string) {
  const [q] = await tx
    .select()
    .from(jobQuotes)
    .where(and(eq(jobQuotes.jobId, jobId), inArray(jobQuotes.status, ['ISSUED', 'ACCEPTED'])))
    .orderBy(desc(jobQuotes.version))
    .limit(1)
  return q ?? null
}

/** Issue a quote, or a new version. Supersedes the previous one, even if accepted. */
export async function issueQuote(
  tx: Tx,
  pr: Pricing,
  p: {
    jobId: string
    lines: QuoteLine[]
    /** Pro's fee. Repairs default to labour share + materials; otherwise the job's pro_base applies. */
    proFeeP?: number | null
    durationMin?: number | null
    exclusions?: string | null
    /** Required for an updated quote; shown to the client. */
    why?: string | null
    discP?: number
    actorId: string | null
    auto?: boolean
    status?: 'ISSUED' | 'ACCEPTED'
  }
) {
  const [job] = await tx
    .select({ status: jobs.status, clientId: jobs.clientId, inspectionType: jobs.inspectionType })
    .from(jobs)
    .where(eq(jobs.id, p.jobId))
    .limit(1)
  if (!job) return { ok: false as const, error: 'Job not found.' }
  // A booking's own fixed-price quote may land on a published job: one with no
  // upfront charge (invoice-later promo) goes live straight away.
  if (!p.auto && !BEFORE_PAYMENT.includes(job.status)) {
    return { ok: false as const, error: 'Already paid. Use a change order for extra work.' }
  }
  const totals = quoteTotals(pr, p.lines, p.discP ?? 0)
  if (totals.totalP <= 0) return { ok: false as const, error: 'The quote total must be more than £0.' }

  const isRepair = job.inspectionType === 'repairs'
  const proFeeP = p.proFeeP ?? (isRepair ? repairProFee(pr, p.lines) : null)
  if (proFeeP != null && (proFeeP < 0 || proFeeP > totals.totalP)) {
    return { ok: false as const, error: 'The Pro fee must be between £0 and the client total.' }
  }

  const prior = await tx
    .select({ version: jobQuotes.version })
    .from(jobQuotes)
    .where(eq(jobQuotes.jobId, p.jobId))
    .orderBy(desc(jobQuotes.version))
    .limit(1)
  const version = (prior[0]?.version ?? 0) + 1
  if (version > 1 && !p.why?.trim()) {
    return { ok: false as const, error: 'Give a reason for updating the quote. The client will see it.' }
  }
  await tx
    .update(jobQuotes)
    .set({ status: 'SUPERSEDED' })
    .where(and(eq(jobQuotes.jobId, p.jobId), inArray(jobQuotes.status, ['ISSUED', 'ACCEPTED'])))

  const status = p.status ?? 'ISSUED'
  const expiresAt = new Date(Date.now() + pr.quoteValidityDays * 86_400_000).toISOString()
  const [quote] = await tx
    .insert(jobQuotes)
    .values({
      jobId: p.jobId,
      version,
      lines: p.lines,
      ...totals,
      proFeeP,
      durationMin: p.durationMin ?? null,
      exclusions: p.exclusions ?? null,
      why: p.why ?? null,
      status,
      auto: Boolean(p.auto),
      issuedBy: p.actorId,
      expiresAt,
      acceptedAt: status === 'ACCEPTED' ? sql`now()` : null,
    } as typeof jobQuotes.$inferInsert)
    .returning()

  await tx
    .update(jobs)
    .set({
      // An updated quote needs accepting again before payment.
      status: status === 'ACCEPTED' ? job.status : 'pending',
      quotedPrice: (totals.totalP / 100).toString(),
      ...(proFeeP != null ? { clerkPayout: (proFeeP / 100).toString() } : {}),
      updatedAt: sql`now()`,
    })
    .where(eq(jobs.id, p.jobId))

  if (!p.auto) {
    await logAuditEvent(tx, {
      category: 'pricing_override',
      action: 'quote.issued',
      actorUserId: p.actorId,
      targetType: 'job',
      targetId: p.jobId,
      payload: { version, totalP: totals.totalP, proFeeP, why: p.why ?? null },
    })
    await tx.insert(notifications).values({
      userId: job.clientId,
      type: 'job',
      title: version > 1 ? 'Your quote was updated' : 'Your quote is ready',
      message: `Job ${ref(p.jobId)}: £${(totals.totalP / 100).toFixed(2)}.${version > 1 && p.why ? ` ${p.why}` : ''}`,
      link: `/client/jobs/${p.jobId}`,
    })
  }
  return { ok: true as const, quote }
}

/** Client accepts: the job now awaits payment. The caller then opens checkout. */
export async function acceptQuote(tx: Tx, p: { jobId: string; actorId: string }, now = new Date()) {
  const q = await currentQuote(tx, p.jobId)
  if (!q || q.status !== 'ISSUED') return { ok: false as const, error: 'This quote is no longer current.' }
  if (q.expiresAt && new Date(q.expiresAt) <= now) {
    return { ok: false as const, error: 'This quote has expired. LISTD will reissue it.' }
  }
  const moved = await tx
    .update(jobs)
    .set({ status: 'draft', updatedAt: sql`now()` })
    .where(and(eq(jobs.id, p.jobId), eq(jobs.status, 'pending')))
    .returning({ id: jobs.id })
  if (!moved.length) return { ok: false as const, error: 'This quote is no longer current.' }
  await tx.update(jobQuotes).set({ status: 'ACCEPTED', acceptedAt: sql`now()` }).where(eq(jobQuotes.id, q.id))
  await logAuditEvent(tx, {
    category: 'job_lifecycle',
    action: 'quote.accepted',
    actorUserId: p.actorId,
    targetType: 'job',
    targetId: p.jobId,
    payload: { version: q.version, totalP: q.totalP },
  })
  return { ok: true as const, quote: q }
}

export async function declineQuote(tx: Tx, p: { jobId: string; actorId: string; reason?: string }) {
  const q = await currentQuote(tx, p.jobId)
  if (!q || q.status !== 'ISSUED') return { ok: false as const, error: 'This quote is no longer current.' }
  await tx.update(jobQuotes).set({ status: 'REJECTED', declineReason: p.reason ?? null }).where(eq(jobQuotes.id, q.id))
  await logAuditEvent(tx, {
    category: 'job_lifecycle',
    action: 'quote.declined',
    actorUserId: p.actorId,
    targetType: 'job',
    targetId: p.jobId,
    payload: { version: q.version, reason: p.reason ?? null },
  })
  return { ok: true as const }
}

/** Cron: issued quotes past their date stop being payable. */
export async function expireQuotes(now = new Date()) {
  const rows = await withServiceRole((tx) =>
    tx
      .update(jobQuotes)
      .set({ status: 'EXPIRED' })
      .where(and(eq(jobQuotes.status, 'ISSUED'), lte(jobQuotes.expiresAt, now.toISOString())))
      .returning({ id: jobQuotes.id })
  )
  return rows.length
}

/* ---- change orders: Pro proposes, LISTD prices, client approves and pays ---- */

export async function proposeChangeOrder(tx: Tx, p: { jobId: string; proId: string; description: string; estimateP?: number }) {
  const [job] = await tx
    .select({ status: jobs.status, clerkId: jobs.clerkId, cleanerId: jobs.cleanerId })
    .from(jobs)
    .where(eq(jobs.id, p.jobId))
    .limit(1)
  if (!job || !['accepted', 'assigned', 'in_progress'].includes(job.status) || (job.clerkId !== p.proId && job.cleanerId !== p.proId)) {
    return { ok: false as const, error: 'Change orders can be proposed on your active job.' }
  }
  const [row] = await tx
    .insert(changeOrders)
    .values({ jobId: p.jobId, proposedBy: p.proId, description: p.description, estimateP: p.estimateP ?? null })
    .returning({ id: changeOrders.id })
  return { ok: true as const, id: row.id }
}

/**
 * LISTD prices the extra work. A diagnosis fee already paid is credited once,
 * against the first priced change order on the job.
 */
export async function priceChangeOrder(
  tx: Tx,
  pr: Pricing,
  p: { id: string; lines: QuoteLine[]; proFeeP?: number; actorId: string }
) {
  const [co] = await tx.select().from(changeOrders).where(eq(changeOrders.id, p.id)).limit(1)
  if (!co) return { ok: false as const, error: 'Change order not found.' }
  if (co.status !== 'PROPOSED') return { ok: false as const, error: 'This change order has already been priced.' }
  const [job] = await tx
    .select({ scope: jobs.scope, clientId: jobs.clientId })
    .from(jobs)
    .where(eq(jobs.id, co.jobId))
    .limit(1)
  const isDiagnosis = (job?.scope as { repairMode?: string } | null)?.repairMode === 'diagnose'
  const [{ credited }] = await tx
    .select({ credited: sql<number>`coalesce(sum(${changeOrders.creditP}), 0)::int` })
    .from(changeOrders)
    .where(eq(changeOrders.jobId, co.jobId))
  const gross = linesTotal(p.lines)
  const creditP = isDiagnosis && credited === 0 ? Math.min(pr.repairs.diagnosisP, gross) : 0
  const totalP = gross - creditP
  const proFeeP = p.proFeeP ?? repairProFee(pr, p.lines)
  await tx
    .update(changeOrders)
    .set({ lines: p.lines, totalP, proFeeP, creditP, status: 'PRICED', pricedAt: sql`now()` })
    .where(eq(changeOrders.id, p.id))
  await logAuditEvent(tx, {
    category: 'pricing_override',
    action: 'change_order.priced',
    actorUserId: p.actorId,
    targetType: 'job',
    targetId: co.jobId,
    payload: { changeOrderId: p.id, totalP, proFeeP, creditP },
  })
  if (job) {
    await tx.insert(notifications).values({
      userId: job.clientId,
      type: 'job',
      title: 'Extra work needs your approval',
      message: `${co.description}: £${(totalP / 100).toFixed(2)}${creditP ? ` after your £${creditP / 100} diagnosis credit` : ''}.`,
      link: `/client/jobs/${co.jobId}`,
    })
  }
  return { ok: true as const, totalP, creditP, proFeeP }
}

export async function decideChangeOrder(tx: Tx, p: { id: string; approve: boolean; actorId: string }) {
  const moved = await tx
    .update(changeOrders)
    .set(p.approve ? { status: 'APPROVED', approvedAt: sql`now()` } : { status: 'REJECTED' })
    .where(and(eq(changeOrders.id, p.id), eq(changeOrders.status, 'PRICED')))
    .returning({ jobId: changeOrders.jobId, totalP: changeOrders.totalP })
  if (!moved.length) return { ok: false as const, error: 'This change order can’t be decided right now.' }
  await logAuditEvent(tx, {
    category: 'job_lifecycle',
    action: p.approve ? 'change_order.approved' : 'change_order.rejected',
    actorUserId: p.actorId,
    targetType: 'job',
    targetId: moved[0].jobId,
    payload: { changeOrderId: p.id, totalP: moved[0].totalP },
  })
  return { ok: true as const, jobId: moved[0].jobId, totalP: moved[0].totalP }
}
