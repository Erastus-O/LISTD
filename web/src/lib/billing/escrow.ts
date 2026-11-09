import 'server-only'
import type Stripe from 'stripe'
import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm'
import { escrowTransactions, jobs, profiles, withServiceRole } from '@/db'
import { logAuditEvent } from '@/lib/audit'
import { logError, logPayment } from '@/lib/logging/logger'
import { notifyMatchingProvidersOnPublish } from '@/lib/notify/job-fanout'
import { getSiteOrigin, getStripe, isStripeConfigured } from './stripe'

/**
 * Stripe Connect escrow for the LISTD marketplace.
 *
 * Flow (adapted from the reference escrow model to LISTD's "pay first, clerk
 * assigned later" marketplace):
 *
 *   1. At booking the client pays the quoted price into a Stripe Checkout
 *      session. Funds land on the PLATFORM balance (no destination — the clerk
 *      isn't known yet) and the job stays `draft` until the charge succeeds.
 *   2. `checkout.session.completed` → escrow `held`, the job is `published`.
 *   3. A Pro accepts and does the work, LISTD reviews it, the client approves
 *      (or the review window closes). The weekly payout run then `transfer`s
 *      the Pro's fee from the held charge to their connected account
 *      (`releaseEscrowForJob`, called from lib/listd/lifecycle).
 *   4. Cancel before release → `refundEscrowForJob`.
 *
 * Every helper is best-effort and never throws into the calling request flow
 * unless noted; callers wrap in try/catch. Escrow is only used when Stripe is
 * configured ({@link isStripeConfigured}) — without it the app behaves exactly
 * as before (job published immediately, no payment).
 */

export { isStripeConfigured }

const toMinor = (pounds: number) => Math.max(0, Math.round(pounds * 100))

/**
 * Create (or reuse) the clerk's Stripe Express account and return an
 * onboarding account link. Stores the account id on their profile.
 */
export async function createClerkConnectOnboardingLink(
  userId: string,
  // Where Stripe sends the user back to after onboarding. Defaults to the
  // clerk settings page; cleaners pass their own settings path so the
  // `?stripe=done` status sync lands on the right surface.
  returnPath = '/clerk/settings'
): Promise<{ url: string }> {
  const stripe = await getStripe()
  const origin = getSiteOrigin()

  const [profile] = await withServiceRole((tx) =>
    tx
      .select({ stripeAccountId: profiles.stripeAccountId })
      .from(profiles)
      .where(eq(profiles.userId, userId))
      .limit(1)
  )
  let accountId = profile?.stripeAccountId ?? null

  if (!accountId) {
    const account = await stripe.accounts.create({
      type: 'express',
      country: 'GB',
      capabilities: { transfers: { requested: true } },
      business_type: 'individual',
      metadata: { listdUserId: userId },
    })
    accountId = account.id
    await withServiceRole((tx) =>
      tx
        .update(profiles)
        .set({
          stripeAccountId: accountId,
          stripeOnboardingStatus: 'pending',
          updatedAt: sql`now()`,
        })
        .where(eq(profiles.userId, userId))
    )
  }

  const link = await stripe.accountLinks.create({
    account: accountId,
    refresh_url: `${origin}${returnPath}?stripe=refresh`,
    return_url: `${origin}${returnPath}?stripe=done`,
    type: 'account_onboarding',
  })
  return { url: link.url }
}

/**
 * One-time login link into the clerk's Stripe Express dashboard, where they can
 * update their bank account / payout details, view payouts, etc. Requires a
 * connected account that's finished onboarding.
 */
export async function createClerkExpressLoginLink(
  userId: string
): Promise<{ url: string }> {
  const stripe = await getStripe()
  const [p] = await withServiceRole((tx) =>
    tx
      .select({ accountId: profiles.stripeAccountId })
      .from(profiles)
      .where(eq(profiles.userId, userId))
      .limit(1)
  )
  if (!p?.accountId) throw new Error('No connected payout account yet.')
  const link = await stripe.accounts.createLoginLink(p.accountId)
  return { url: link.url }
}

/**
 * Pull the clerk's current Connect status straight from Stripe and persist it.
 * Used on the return from onboarding (`?stripe=done`) so the UI doesn't depend
 * on the `account.updated` webhook having already arrived. No-throw.
 */
export async function syncClerkConnectStatus(userId: string): Promise<void> {
  if (!isStripeConfigured()) return
  const [p] = await withServiceRole((tx) =>
    tx
      .select({ accountId: profiles.stripeAccountId })
      .from(profiles)
      .where(eq(profiles.userId, userId))
      .limit(1)
  )
  if (!p?.accountId) return
  try {
    const stripe = await getStripe()
    const account = await stripe.accounts.retrieve(p.accountId)
    await updateClerkConnectFromAccount(account)
  } catch (err) {
    console.warn('[escrow] sync connect status failed:', err)
  }
}

/** Sync a clerk's Connect flags from a Stripe `account.updated` event. */
export async function updateClerkConnectFromAccount(
  account: Stripe.Account
): Promise<void> {
  const complete =
    Boolean(account.charges_enabled) &&
    Boolean(account.payouts_enabled) &&
    Boolean(account.details_submitted)
  const updated = await withServiceRole((tx) =>
    tx
      .update(profiles)
      .set({
        stripeChargesEnabled: Boolean(account.charges_enabled),
        stripePayoutsEnabled: Boolean(account.payouts_enabled),
        stripeDetailsSubmitted: Boolean(account.details_submitted),
        stripeOnboardingStatus: complete
          ? 'complete'
          : account.requirements?.disabled_reason
            ? 'restricted'
            : 'pending',
        updatedAt: sql`now()`,
      })
      .where(eq(profiles.stripeAccountId, account.id))
      .returning({ userId: profiles.userId })
  )

  // Now that this worker can receive payouts, release any escrow that was held
  // back because they weren't onboarded when their work was approved (the
  // approve-before-onboarding race). Best-effort + idempotent.
  if (account.payouts_enabled && updated[0]?.userId) {
    await releaseHeldEscrowsForWorker(updated[0].userId)
  }
}

/**
 * Release every escrow still `held` for a worker's already-`completed` jobs —
 * whether they're the assigned clerk (inspections) or cleaner (cleaning).
 * Called when their payouts become enabled, so a payout deferred at approval
 * time settles automatically without an admin retry.
 */
async function releaseHeldEscrowsForWorker(workerId: string): Promise<void> {
  const rows = await withServiceRole((tx) =>
    tx
      .select({ jobId: escrowTransactions.jobId })
      .from(escrowTransactions)
      .innerJoin(jobs, eq(jobs.id, escrowTransactions.jobId))
      .where(
        and(
          eq(escrowTransactions.status, 'held'),
          eq(jobs.status, 'completed'),
          or(eq(jobs.clerkId, workerId), eq(jobs.cleanerId, workerId))
        )
      )
  )
  for (const r of rows) {
    if (!r.jobId) continue
    const res = await releaseEscrowForJob(r.jobId).catch(() => ({
      released: false,
      reason: 'error' as const,
    }))
    if (!res.released && res.reason !== 'no_held_escrow') {
      console.warn(
        `[escrow] auto-release on onboarding deferred for job ${r.jobId}:`,
        res.reason
      )
    }
  }
}

/**
 * Create the escrow rows + one Checkout session that HOLDS the client's payment
 * on the platform. Services booked together share the session (one payment) but
 * each keeps its own escrow row, so payouts and refunds stay per service.
 */
export async function createEscrowCheckoutForJobs(params: {
  clientUserId: string
  items: Array<{
    jobId: string
    grossPounds: number
    clerkPounds: number
    description: string
  }>
}): Promise<{ url: string; escrowIds: string[] }> {
  const stripe = await getStripe()
  const origin = getSiteOrigin()
  const items = params.items.map((i) => {
    const gross = toMinor(i.grossPounds)
    const clerk = toMinor(i.clerkPounds)
    return { ...i, gross, clerk, fee: Math.max(0, gross - clerk) }
  })

  const rows = await withServiceRole((tx) =>
    tx
      .insert(escrowTransactions)
      .values(
        items.map((i) => ({
          jobId: i.jobId,
          clientUserId: params.clientUserId,
          currency: 'gbp',
          grossAmount: i.gross,
          clerkAmount: i.clerk,
          platformFee: i.fee,
          status: 'pending',
        }))
      )
      .returning({ id: escrowTransactions.id, jobId: escrowTransactions.jobId })
  )
  const escrowIds = rows.map((r) => r.id)
  const primary = rows[0]
  const transferGroup = `ESCROW_${primary.id}`
  const metadata = {
    type: 'escrow',
    escrowId: primary.id,
    jobId: primary.jobId,
    // Stripe caps a metadata value at 500 chars: 13 uuids. Bookings are six at most.
    escrowIds: escrowIds.join(','),
  }

  const session = await stripe.checkout.sessions.create(
    {
      mode: 'payment',
      currency: 'gbp',
      // Disable Stripe Adaptive Pricing. Left on (the account default), it
      // presents the price in the customer's local currency and the charge
      // SETTLES in that currency, which then breaks the Pro payout, because
      // a `source_transaction` transfer must match the charge's balance-
      // transaction currency. LISTD bills + pays out in GBP, so force the
      // charge to settle in GBP.
      adaptive_pricing: { enabled: false },
      payment_method_types: ['card'],
      line_items: items.map((i) => ({
        quantity: 1,
        price_data: {
          currency: 'gbp',
          unit_amount: i.gross,
          product_data: { name: i.description.slice(0, 250) },
        },
      })),
      client_reference_id: primary.jobId,
      payment_intent_data: { transfer_group: transferGroup, metadata },
      metadata,
      success_url: `${origin}/client/jobs?paid=${primary.jobId}`,
      cancel_url: `${origin}/client/jobs/${primary.jobId}?payment=cancelled`,
    },
    { idempotencyKey: `escrow_checkout_${primary.id}` }
  )

  await withServiceRole((tx) =>
    tx
      .update(escrowTransactions)
      .set({
        stripeCheckoutSessionId: session.id,
        transferGroup,
        updatedAt: sql`now()`,
      })
      .where(inArray(escrowTransactions.id, escrowIds))
  )

  if (!session.url) throw new Error('Stripe did not return a checkout URL')
  await logPayment('checkout.created', 'Escrow checkout session created', {
    jobIds: rows.map((r) => r.jobId),
    escrowIds,
    sessionId: session.id,
    grossPence: items.reduce((a, i) => a + i.gross, 0),
  })
  return { url: session.url, escrowIds }
}

/** Single-job form, kept for callers that book one service. */
export async function createEscrowCheckoutForJob(params: {
  jobId: string
  clientUserId: string
  grossPounds: number
  clerkPounds: number
  description: string
}): Promise<{ url: string; escrowId: string }> {
  const { url, escrowIds } = await createEscrowCheckoutForJobs({
    clientUserId: params.clientUserId,
    items: [params],
  })
  return { url, escrowId: escrowIds[0] }
}

/**
 * Mint a FRESH Stripe Checkout session for a job that's still awaiting payment
 * (draft job + a `pending` escrow row). Used by the owner-pays-via-link flow so
 * the payment link never goes stale — Stripe Checkout sessions expire after
 * ~24h, and this lets the owner regenerate one on demand.
 *
 * Reuses the existing pending escrow row (no duplicate escrow) and just points
 * it at the new session. Returns null when the job isn't awaiting payment
 * (already published/paid, or no pending escrow).
 */
export async function refreshEscrowCheckoutForJob(
  jobId: string
): Promise<{ url: string } | null> {
  // Services booked together are paid together, so a fresh link covers every
  // service in the group that's still awaiting payment.
  const rows = await withServiceRole((tx) =>
    tx
      .select({
        escrowId: escrowTransactions.id,
        gross: escrowTransactions.grossAmount,
        jobId: escrowTransactions.jobId,
      })
      .from(escrowTransactions)
      .innerJoin(jobs, eq(jobs.id, escrowTransactions.jobId))
      .where(
        and(
          eq(escrowTransactions.status, 'pending'),
          eq(jobs.status, 'draft'),
          or(
            eq(jobs.id, jobId),
            sql`${jobs.groupId} = (select j.group_id from jobs j where j.id = ${jobId})`
          )
        )
      )
      .orderBy(desc(escrowTransactions.createdAt))
  )
  if (!rows.length || !rows.some((r) => r.jobId === jobId)) return null

  const primary = rows.find((r) => r.jobId === jobId) ?? rows[0]
  const escrowIds = rows.map((r) => r.escrowId)
  const stripe = await getStripe()
  const origin = getSiteOrigin()
  const transferGroup = `ESCROW_${primary.escrowId}`
  const metadata = {
    type: 'escrow',
    escrowId: primary.escrowId,
    jobId,
    escrowIds: escrowIds.join(','),
  }
  // No idempotency key: every call deliberately creates a new session so an
  // expired link can be replaced. The webhook matches on the escrow ids, so
  // paying any live session publishes the jobs exactly once.
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    currency: 'gbp',
    adaptive_pricing: { enabled: false },
    payment_method_types: ['card'],
    line_items: rows.map((r) => ({
      quantity: 1,
      price_data: {
        currency: 'gbp',
        unit_amount: r.gross,
        product_data: { name: 'LISTD job payment' },
      },
    })),
    client_reference_id: jobId,
    payment_intent_data: { transfer_group: transferGroup, metadata },
    metadata,
    success_url: `${origin}/client/jobs?paid=${jobId}`,
    cancel_url: `${origin}/client/jobs?payment=cancelled`,
  })
  if (!session.url) throw new Error('Stripe did not return a checkout URL')

  await withServiceRole((tx) =>
    tx
      .update(escrowTransactions)
      .set({ stripeCheckoutSessionId: session.id, updatedAt: sql`now()` })
      .where(inArray(escrowTransactions.id, escrowIds))
  )
  await logPayment('checkout.refreshed', 'Escrow checkout session regenerated', {
    jobId,
    escrowIds,
    sessionId: session.id,
  })
  return { url: session.url }
}

/**
 * Webhook fulfilment: a paid escrow Checkout session → mark the escrow `held`
 * (capture the charge id for the later transfer) and `publish` the job.
 * Returns the jobId so the caller can write the lifecycle audit row.
 */
export async function fulfilEscrowCheckout(
  session: Stripe.Checkout.Session
): Promise<{ jobId: string } | null> {
  const escrowId = session.metadata?.escrowId
  const jobId = session.metadata?.jobId
  if (!escrowId || !jobId || session.payment_status !== 'paid') return null

  const stripe = await getStripe()
  const piId =
    typeof session.payment_intent === 'string'
      ? session.payment_intent
      : session.payment_intent?.id ?? null
  let chargeId: string | null = null
  if (piId) {
    try {
      const pi = await stripe.paymentIntents.retrieve(piId)
      chargeId =
        typeof pi.latest_charge === 'string'
          ? pi.latest_charge
          : pi.latest_charge?.id ?? null
    } catch {
      /* charge id can also arrive via payment_intent.succeeded */
    }
  }

  const escrowIds = session.metadata?.escrowIds
    ? session.metadata.escrowIds.split(',').filter(Boolean)
    : [escrowId]

  const published = await withServiceRole(async (tx) => {
    const held = await tx
      .update(escrowTransactions)
      .set({
        status: 'held',
        stripePaymentIntent: piId,
        stripeChargeId: chargeId,
        heldAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          inArray(escrowTransactions.id, escrowIds),
          eq(escrowTransactions.status, 'pending')
        )
      )
      .returning({ jobId: escrowTransactions.jobId })
    const jobIds = held.map((h) => h.jobId)
    if (!jobIds.length) return []
    // Only the first webhook delivery flips draft → published; Stripe retries
    // affect zero rows. `returning` lets us notify providers exactly once.
    const flipped = await tx
      .update(jobs)
      .set({ status: 'published', updatedAt: sql`now()` })
      .where(and(inArray(jobs.id, jobIds), eq(jobs.status, 'draft')))
      .returning({ id: jobs.id })
    for (const f of flipped) {
      await logAuditEvent(tx, {
        category: 'job_lifecycle',
        action: 'job.published',
        actorUserId: null,
        targetType: 'job',
        targetId: f.id,
        payload: { priorStatus: 'draft', via: 'escrow_payment', escrowIds },
      })
    }
    return flipped.map((f) => f.id)
  })
  await logPayment('escrow.held', 'Payment captured; escrow held, job published', {
    jobId,
    escrowIds,
    chargeId,
    paymentIntent: piId,
  })
  // Now the jobs are live: ping providers whose coverage (+ service type) matches
  // the property's postcode. Best-effort, and only on the transition, so Stripe
  // retries don't re-notify.
  for (const id of published) {
    await notifyMatchingProvidersOnPublish(id)
  }
  return { jobId }
}

/**
 * Backfill the escrow's charge id from a `payment_intent.succeeded` event — a
 * safety net when the charge wasn't yet attached at `checkout.session.completed`
 * time. The charge id is required for the later release transfer.
 */
export async function recordEscrowChargeFromPI(
  paymentIntentId: string,
  chargeId: string | null
): Promise<void> {
  if (!chargeId) return
  await withServiceRole((tx) =>
    tx
      .update(escrowTransactions)
      .set({ stripeChargeId: chargeId, updatedAt: sql`now()` })
      .where(
        and(
          eq(escrowTransactions.stripePaymentIntent, paymentIntentId),
          isNull(escrowTransactions.stripeChargeId)
        )
      )
  )
}

/**
 * Release the held escrow to the Pro who did the job (called by the weekly
 * payout run, after the client approves). Transfers the Pro's fee from the held
 * charge to their connected account. No-throw — returns a reason when it can't release so the approval
 * still succeeds and the payout can be retried.
 */
export async function releaseEscrowForJob(
  jobId: string
): Promise<{ released: boolean; reason?: string; transferId?: string }> {
  try {
    const [escrow] = await withServiceRole((tx) =>
      tx
        .select()
        .from(escrowTransactions)
        .where(
          and(
            eq(escrowTransactions.jobId, jobId),
            eq(escrowTransactions.status, 'held')
          )
        )
        .limit(1)
    )
    if (!escrow) return { released: false, reason: 'no_held_escrow' }
    if (!escrow.stripeChargeId) {
      return { released: false, reason: 'charge_not_settled' }
    }

    // The paid worker is the cleaner for cleaning jobs (clean_*), the clerk
    // otherwise. Both reuse the same Stripe Connect columns on `profiles`.
    const [job] = await withServiceRole((tx) =>
      tx
        .select({
          clerkId: jobs.clerkId,
          cleanerId: jobs.cleanerId,
          inspectionType: jobs.inspectionType,
        })
        .from(jobs)
        .where(eq(jobs.id, jobId))
        .limit(1)
    )
    const isClean = job?.inspectionType?.startsWith('clean_') ?? false
    const workerId = isClean ? job?.cleanerId : job?.clerkId
    if (!workerId) return { released: false, reason: 'no_worker' }

    const [worker] = await withServiceRole((tx) =>
      tx
        .select({
          stripeAccountId: profiles.stripeAccountId,
          payoutsEnabled: profiles.stripePayoutsEnabled,
        })
        .from(profiles)
        .where(eq(profiles.userId, workerId))
        .limit(1)
    )
    if (!worker?.stripeAccountId || !worker.payoutsEnabled) {
      await logPayment(
        'escrow.release_deferred',
        'Payout deferred: worker payouts not enabled',
        { jobId, escrowId: escrow.id, workerId, reason: 'worker_not_onboarded' },
        { level: 'warn' }
      )
      return { released: false, reason: 'worker_not_onboarded' }
    }

    const stripe = await getStripe()
    const transfer = await stripe.transfers.create(
      {
        amount: escrow.clerkAmount,
        currency: escrow.currency,
        destination: worker.stripeAccountId,
        source_transaction: escrow.stripeChargeId,
        ...(escrow.transferGroup
          ? { transfer_group: escrow.transferGroup }
          : {}),
        metadata: { escrowId: escrow.id, jobId },
      },
      { idempotencyKey: `release_${escrow.id}` }
    )

    const paidPounds = String(escrow.clerkAmount / 100)
    await withServiceRole(async (tx) => {
      await tx
        .update(escrowTransactions)
        .set({
          status: 'released',
          clerkId: workerId,
          stripeTransferId: transfer.id,
          releasedAt: sql`now()`,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(escrowTransactions.id, escrow.id),
            eq(escrowTransactions.status, 'held')
          )
        )
      // Reflect the payout on the job so the worker's earnings flip from
      // "Pending" to "Paid": stamp the payment date + finalised payout on the
      // right (clerk vs cleaner) columns.
      await tx
        .update(jobs)
        .set(
          isClean
            ? {
                cleanerPaymentDate: sql`now()`,
                cleanerFinalPayout: paidPounds,
                updatedAt: sql`now()`,
              }
            : {
                clerkPaymentDate: sql`now()`,
                clerkFinalPayout: paidPounds,
                updatedAt: sql`now()`,
              }
        )
        .where(eq(jobs.id, jobId))
    })
    await logPayment('escrow.released', 'Payout transferred to worker', {
      jobId,
      escrowId: escrow.id,
      workerId,
      transferId: transfer.id,
      amountPence: escrow.clerkAmount,
      currency: escrow.currency,
      worker: isClean ? 'cleaner' : 'clerk',
    })
    return { released: true, transferId: transfer.id }
  } catch (err) {
    console.error('[escrow] release failed:', err)
    await logError('escrow.release_failed', err, { jobId })
    return { released: false, reason: 'error' }
  }
}

/** Refund a held escrow to the client (called when a paid job is cancelled). */
export async function refundEscrowForJob(
  jobId: string
): Promise<{ refunded: boolean; reason?: string }> {
  try {
    const [escrow] = await withServiceRole((tx) =>
      tx
        .select()
        .from(escrowTransactions)
        .where(
          and(
            eq(escrowTransactions.jobId, jobId),
            eq(escrowTransactions.status, 'held')
          )
        )
        .limit(1)
    )
    if (!escrow) return { refunded: false, reason: 'no_held_escrow' }
    if (!escrow.stripePaymentIntent) {
      return { refunded: false, reason: 'no_payment_intent' }
    }

    const stripe = await getStripe()
    const refund = await stripe.refunds.create(
      {
        payment_intent: escrow.stripePaymentIntent,
        // This job's share only: one payment can cover several linked services.
        amount: escrow.grossAmount,
        metadata: { escrowId: escrow.id, jobId },
      },
      { idempotencyKey: `refund_${escrow.id}` }
    )

    await withServiceRole((tx) =>
      tx
        .update(escrowTransactions)
        .set({
          status: 'refunded',
          stripeRefundId: refund.id,
          refundedAt: sql`now()`,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(escrowTransactions.id, escrow.id),
            eq(escrowTransactions.status, 'held')
          )
        )
    )
    await logPayment('escrow.refunded', 'Escrow refunded to client', {
      jobId,
      escrowId: escrow.id,
      refundId: refund.id,
      paymentIntent: escrow.stripePaymentIntent,
    })
    return { refunded: true }
  } catch (err) {
    console.error('[escrow] refund failed:', err)
    await logError('escrow.refund_failed', err, { jobId })
    return { refunded: false, reason: 'error' }
  }
}
