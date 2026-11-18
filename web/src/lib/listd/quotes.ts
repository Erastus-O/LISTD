import 'server-only'
import { and, desc, eq, inArray, lte, sql } from 'drizzle-orm'
import { changeOrders, jobQuotes, jobs, notifications, userRoles, withServiceRole, type Tx } from '@/db'
import { logAuditEvent } from '@/lib/audit'
import { jobPriceP, linesTotal, proNetFor, quoteTotals, requoteTotals, type Pricing, type QuoteLine } from './pricing'

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
    /** Pro's net. Defaults to the job price less LISTD's commission. */
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

  const proFeeP = p.proFeeP ?? proNetFor(pr, p.lines)
  if (proFeeP < 0 || proFeeP > totals.totalP) {
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
      subP: totals.subP,
      taxP: totals.taxP,
      discP: totals.discP,
      totalP: totals.totalP,
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
      ...(job.inspectionType.startsWith('clean_') ? { cleanerPayout: (proFeeP / 100).toString() } : { clerkPayout: (proFeeP / 100).toString() }),
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

export async function proposeChangeOrder(
  tx: Tx,
  p: { jobId: string; proId: string; description: string; estimateP?: number; evidencePaths?: string[] }
) {
  const [job] = await tx
    .select({ status: jobs.status, clerkId: jobs.clerkId, cleanerId: jobs.cleanerId })
    .from(jobs)
    .where(eq(jobs.id, p.jobId))
    .limit(1)
  if (!job || !['accepted', 'assigned', 'in_progress'].includes(job.status) || (job.clerkId !== p.proId && job.cleanerId !== p.proId)) {
    return { ok: false as const, error: 'Change orders can be proposed on your active job.' }
  }
  // Evidence must sit under this job's folder, so a Pro can't attach someone else's files.
  const evidence = (p.evidencePaths ?? []).filter((x) => x.startsWith(`${p.jobId}/`))
  const [row] = await tx
    .insert(changeOrders)
    .values({ jobId: p.jobId, proposedBy: p.proId, description: p.description, estimateP: p.estimateP ?? null, evidencePaths: evidence })
    .returning({ id: changeOrders.id })
  const admins = await tx.select({ userId: userRoles.userId }).from(userRoles).where(eq(userRoles.role, 'admin'))
  if (admins.length) {
    await tx.insert(notifications).values(
      [...new Set(admins.map((a) => a.userId))].map((userId) => ({
        userId,
        type: 'job',
        title: 'Requote to price',
        message: `Job ${ref(p.jobId)}: ${p.description.slice(0, 120)}${p.estimateP ? ` (Pro estimate £${(p.estimateP / 100).toFixed(2)})` : ''}`,
        link: `/admin/jobs/${p.jobId}`,
      }))
    )
  }
  return { ok: true as const, id: row.id }
}

/**
 * The job price so far: the accepted quote plus extra work already approved.
 * `clientJobP` is after discounts (what the booking fee is on); `proJobP` is
 * before LISTD-funded discounts (what the Pro's commission comes off).
 */
export async function jobPriceSoFar(tx: Tx, jobId: string) {
  const q = await currentQuote(tx, jobId)
  const extras = await tx
    .select({ lines: changeOrders.lines, creditP: changeOrders.creditP })
    .from(changeOrders)
    .where(and(eq(changeOrders.jobId, jobId), inArray(changeOrders.status, ['APPROVED', 'PAID'])))
  const extraP = extras.reduce((a, c) => a + linesTotal((c.lines as QuoteLine[] | null) ?? []) - c.creditP, 0)
  const lines = (q?.lines as QuoteLine[] | undefined) ?? []
  return {
    clientJobP: Math.max(0, (q?.subP ?? 0) - (q?.discP ?? 0)) + extraP,
    proJobP: jobPriceP(lines) + extraP,
  }
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
  // Both fees are recalculated on the new total job price: the client pays the
  // difference (extra work plus any change in booking fee), the Pro's net rises.
  const before = await jobPriceSoFar(tx, co.jobId)
  const r = requoteTotals(pr, before, gross - creditP)
  const totalP = r.clientExtraP
  const proFeeP = p.proFeeP ?? r.proExtraP
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
    .returning({ jobId: changeOrders.jobId, totalP: changeOrders.totalP, proFeeP: changeOrders.proFeeP })
  if (!moved.length) return { ok: false as const, error: 'This change order can’t be decided right now.' }
  await tx.update(changeOrders).set({ decidedAt: sql`now()` }).where(eq(changeOrders.id, p.id))
  const [co] = await tx
    .select({ proposedBy: changeOrders.proposedBy, description: changeOrders.description })
    .from(changeOrders)
    .where(eq(changeOrders.id, p.id))
    .limit(1)
  if (co?.proposedBy) {
    const [j] = await tx.select({ type: jobs.inspectionType }).from(jobs).where(eq(jobs.id, moved[0].jobId)).limit(1)
    const area = j?.type.startsWith('clean_') ? 'cleaner' : 'clerk'
    await tx.insert(notifications).values({
      userId: co.proposedBy,
      type: 'job',
      title: p.approve ? 'Extra work approved' : 'Extra work declined',
      message: p.approve
        ? `The client approved: ${co.description.slice(0, 120)}. Your earnings on job ${ref(moved[0].jobId)} have gone up.`
        : `The client declined: ${co.description.slice(0, 120)}. Finish job ${ref(moved[0].jobId)} as originally specified.`,
      link: `/${area}/jobs/${moved[0].jobId}`,
    })
  }
  if (p.approve) {
    // Added to the job: the client's price and the Pro's net both go up.
    const addP = moved[0].totalP ?? 0
    const proP = moved[0].proFeeP ?? 0
    await tx.execute(sql`
      update jobs
         set quoted_price = coalesce(quoted_price, 0) + ${addP / 100},
             clerk_payout = case when inspection_type like 'clean\\_%' then clerk_payout else coalesce(clerk_payout, 0) + ${proP / 100} end,
             cleaner_payout = case when inspection_type like 'clean\\_%' then coalesce(cleaner_payout, 0) + ${proP / 100} else cleaner_payout end,
             updated_at = now()
       where id = ${moved[0].jobId}
    `)
  }
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
