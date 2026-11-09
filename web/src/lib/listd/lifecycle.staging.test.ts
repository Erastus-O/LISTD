import { randomUUID } from 'node:crypto'
import { getTableColumns, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq, and } from 'drizzle-orm'
import * as schema from '@/db/schema/schema'
import {
  changeOrders,
  clientRebates,
  disputes,
  escrowTransactions,
  jobQuotes,
  jobs,
  proRoleLevels,
  profiles,
  properties,
  trainingCompletions,
  trainings,
  userRoles,
  withServiceRole,
  db,
} from '@/db'
import { createBookingJobs, planBooking } from './booking'
import {
  approveJob,
  autoApproveDueJobs,
  pauseReviewForDispute,
  payableJobs,
  releaseToClient,
  requestCorrection,
  resumeReviewAfterDispute,
  runWeeklyPayouts,
} from './lifecycle'
import { clientPortfolio } from './portfolio'
import { DEFAULT_PRICING as pr, type QuoteLine } from './pricing'
import {
  applyForLevel,
  decideLevelApplication,
  getProLevel,
  levelRequirements,
  proEligibility,
  proJobBlock,
  proVerificationBlock,
  setFeeForAcceptingPro,
  setProLevel,
  standardsCheck,
} from './pro-levels'
import { acceptQuote, currentQuote, declineQuote, decideChangeOrder, expireQuotes, issueQuote, priceChangeOrder, proposeChangeOrder } from './quotes'
import { toPricedProperty } from './services'

const created: { users: string[]; props: string[]; trainings: string[] } = { users: [], props: [], trainings: [] }

async function makeUser(role: 'client' | 'clerk' | 'cleaner' | 'trades') {
  const id = randomUUID()
  await db.execute(sql`insert into auth.users (id, email) values (${id}, ${`${id}@staging.invalid`})`)
  // handle_new_user creates the profile.
  await db.insert(userRoles).values({ userId: id, role })
  created.users.push(id)
  return id
}

async function makeProperty(clientId: string, over: Partial<typeof properties.$inferInsert> = {}) {
  const [p] = await db
    .insert(properties)
    .values({ clientId, addressLine1: '1 Test St', city: 'Bristol', postcode: 'BS8 1TH', bedrooms: 2, ...over } as typeof properties.$inferInsert)
    .returning()
  created.props.push(p.id)
  return p
}

// A date a week ahead on a weekday, so it's always Standard.
function standardDate() {
  const d = new Date(Date.now() + 8 * 86_400_000)
  while (d.getUTCDay() % 6 === 0) d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

async function book(clientId: string, propertyId: string, services: Parameters<typeof planBooking>[2]['services'], scope = {}) {
  const [prop] = await db.select().from(properties).where(eq(properties.id, propertyId))
  const scheduledDate = standardDate()
  const planned = planBooking(pr, { ...toPricedProperty(prop), postcode: prop.postcode }, { services, scope, scheduledDate })
  if (!planned.ok) throw new Error(planned.error)
  return withServiceRole((tx) =>
    createBookingJobs(tx, pr, {
      plan: planned.plan,
      propertyId,
      clientId,
      createdByUserId: clientId,
      organisationId: null,
      scheduledDate,
      scope,
      requirePayment: true,
    })
  )
}

/** Stand in for the Stripe webhook: payment held, job published. */
async function paid(jobId: string, clientId: string, grossP: number, clerkP: number) {
  await db.insert(escrowTransactions).values({
    jobId,
    clientUserId: clientId,
    grossAmount: grossP,
    clerkAmount: clerkP,
    platformFee: grossP - clerkP,
    status: 'held',
    stripeChargeId: `ch_test_${jobId}`,
  })
  await db.update(jobs).set({ status: 'published' }).where(eq(jobs.id, jobId))
}

async function jobRow(id: string) {
  const [j] = await db.select().from(jobs).where(eq(jobs.id, id))
  return j
}

beforeAll(async () => {
  // These suites assert on what's payable or due across the whole database, so
  // start from no leftovers of earlier runs.
  await db.execute(sql`update jobs set payout_eligible_at = null, client_review_due_at = null where client_id in (select id from auth.users where email like '%@staging.invalid')`)
})

afterAll(async () => {
  for (const id of created.users) {
    await db.delete(clientRebates).where(eq(clientRebates.clientId, id))
    await db.delete(escrowTransactions).where(eq(escrowTransactions.clientUserId, id))
    await db.delete(disputes).where(eq(disputes.raisedBy, id))
    await db.delete(jobs).where(eq(jobs.clientId, id))
    await db.delete(proRoleLevels).where(eq(proRoleLevels.userId, id))
    await db.delete(trainingCompletions).where(eq(trainingCompletions.userId, id))
  }
  for (const id of created.props) await db.delete(properties).where(eq(properties.id, id))
  for (const id of created.trainings) await db.delete(trainings).where(eq(trainings.id, id))
  for (const id of created.users) {
    await db.delete(userRoles).where(eq(userRoles.userId, id))
    await db.delete(profiles).where(eq(profiles.userId, id))
    await db.execute(sql`delete from public.organisation_members where user_id = ${id}`)
    await db.execute(sql`delete from public.organisations where created_by = ${id}`)
    await db.execute(sql`delete from auth.users where id = ${id}`)
  }
})

describe('schema', () => {
  it('every column the code knows about exists in the staging database', async () => {
    const rows = await db.execute<{ table_name: string; column_name: string }>(sql`
      select table_name, column_name from information_schema.columns where table_schema = 'public'
    `)
    const have = new Set(Array.from(rows as Iterable<{ table_name: string; column_name: string }>).map((r) => `${r.table_name}.${r.column_name}`))
    const missing: string[] = []
    for (const value of Object.values(schema)) {
      const table = value as unknown as { [k: symbol]: unknown }
      const nameSym = Object.getOwnPropertySymbols(table ?? {}).find((s) => s.description === 'drizzle:Name')
      if (!nameSym) continue
      const tableName = table[nameSym] as string
      for (const col of Object.values(getTableColumns(value as never)) as Array<{ name: string }>) {
        if (!have.has(`${tableName}.${col.name}`)) missing.push(`${tableName}.${col.name}`)
      }
    }
    expect(missing).toEqual([])
  })

  it('new tables are closed to signed-in users (RLS on, no policies)', async () => {
    const client = await makeUser('client')
    const claims = JSON.stringify({ sub: client, role: 'authenticated' })
    const count = await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('role', 'authenticated', true)`)
      await tx.execute(sql`select set_config('request.jwt.claims', ${claims}, true)`)
      const r = await tx.execute<{ n: number }>(sql`select count(*)::int n from public.job_quotes`)
      return Array.from(r as Iterable<{ n: number }>)[0].n
    })
    expect(count).toBe(0)
  })
})

describe('booking', () => {
  it('creates one linked job per service, with fixed prices as accepted quotes', async () => {
    const client = await makeUser('client')
    const prop = await makeProperty(client, { furnishedStatus: 'furnished' })
    const rows = await book(client, prop.id, ['INVENTORY', 'CHECK_IN'])
    expect(rows).toHaveLength(2)
    const [a, b] = await Promise.all(rows.map((r) => jobRow(r.jobId)))
    expect(a.groupId).toBeTruthy()
    expect(a.groupId).toBe(b.groupId)
    expect(a.status).toBe('draft')
    // The worked example from the website: £145 same visit + £20 furnishing.
    expect(Number(a.quotedPrice) + Number(b.quotedPrice)).toBe(165)
    const q = await withServiceRole((tx) => currentQuote(tx, rows[0].jobId))
    expect(q?.status).toBe('ACCEPTED')
    expect(q?.auto).toBe(true)
  })

  it('sends cleaning and fixed repairs to LISTD for a quote', async () => {
    const client = await makeUser('client')
    const prop = await makeProperty(client)
    const rows = await book(client, prop.id, ['CLEANING', 'REPAIRS_DAMAGES'], { clean: 'deep', repairMode: 'fixed', category: 'Plumbing' })
    const [clean, repair] = await Promise.all(rows.map((r) => jobRow(r.jobId)))
    expect(clean.status).toBe('pending')
    expect(clean.inspectionType).toBe('clean_deep')
    expect(clean.requiredLevel).toBe(3)
    expect(repair.status).toBe('pending')
    expect(repair.inspectionType).toBe('repairs')
    expect(await withServiceRole((tx) => currentQuote(tx, repair.id))).toBeNull()
  })

  it('refuses areas LISTD does not serve, and Birmingham inspections', async () => {
    const pp = { ...toPricedProperty({ bedrooms: 1, bathrooms: 1, kitchens: 1 }) }
    const date = standardDate()
    expect(planBooking(pr, { ...pp, postcode: 'M1 1AA' }, { services: ['CLEANING'], scheduledDate: date })).toMatchObject({ ok: false })
    expect(planBooking(pr, { ...pp, postcode: 'B12 9AA' }, { services: ['CHECK_OUT'], scheduledDate: date })).toMatchObject({ ok: false })
    expect(planBooking(pr, { ...pp, postcode: 'B12 9AA' }, { services: ['CLEANING'], scheduledDate: date })).toMatchObject({ ok: true })
  })

  it('makes a date within two working days a Priority booking', () => {
    const planned = planBooking(pr, { ...toPricedProperty({ bedrooms: 2, bathrooms: 1, kitchens: 1 }), postcode: 'BS1 1AA' }, { services: ['CHECK_OUT'], scheduledDate: '2026-11-04', today: '2026-11-02' })
    expect(planned).toMatchObject({ ok: true, plan: { sched: 'priority', payNowP: 11000 + 3000 } })
  })
})

describe('Pro level gate', () => {
  it('a Level 1 clerk can take a 2-bed but not a 3-bed; Level 2 can, and earns their own rate', async () => {
    const client = await makeUser('client')
    const clerk = await makeUser('clerk')
    const small = await makeProperty(client)
    const big = await makeProperty(client, { bedrooms: 3 })
    const [s] = await book(client, small.id, ['CHECK_OUT'])
    const [b] = await book(client, big.id, ['CHECK_OUT'])
    const target = (id: string, bedrooms: number) => jobRow(id).then((j) => ({ inspectionType: j.inspectionType, requiredLevel: j.requiredLevel, bedrooms }))

    await withServiceRole(async (tx) => {
      expect(await proJobBlock(tx, clerk, await target(s.jobId, 2))).toBeNull()
      expect(await proJobBlock(tx, clerk, await target(b.jobId, 3))).toMatch(/Pro Clerk · Level 2/)
      const canTake = await proEligibility(tx, clerk)
      expect(canTake(await target(b.jobId, 3))).toBe(false)
      const set = await setProLevel(tx, { userId: clerk, role: 'CLERK', level: 2, actorId: clerk, reason: 'Ten years of experience and a portfolio' })
      expect(set.ok).toBe(true)
      expect(await proJobBlock(tx, clerk, await target(b.jobId, 3))).toBeNull()
    })

    await paid(b.jobId, client, b.plan.totalP, b.plan.proFeeP ?? 0)
    const fee = await withServiceRole((tx) => setFeeForAcceptingPro(tx, pr, b.jobId, clerk))
    expect(fee?.level).toBe(2)
    const [escrow] = await db.select().from(escrowTransactions).where(eq(escrowTransactions.jobId, b.jobId))
    expect(escrow.clerkAmount).toBe(fee?.feeP)
    expect(escrow.platformFee).toBe(escrow.grossAmount - (fee?.feeP ?? 0))
  })

  it('needs the right role: a clerk cannot take a clean or a repair', async () => {
    const client = await makeUser('client')
    const clerk = await makeUser('clerk')
    const prop = await makeProperty(client)
    const rows = await book(client, prop.id, ['CLEANING', 'REPAIRS_DAMAGES'], { clean: 'standard', repairMode: 'fixed' })
    await withServiceRole(async (tx) => {
      for (const r of rows) {
        const j = await jobRow(r.jobId)
        expect(await proJobBlock(tx, clerk, { inspectionType: j.inspectionType, requiredLevel: j.requiredLevel, bedrooms: 2 })).toMatch(/role/)
      }
    })
  })
})

describe('vetting', () => {
  it('blocks a Pro from accepting until LISTD has verified them', async () => {
    for (const role of ['clerk', 'cleaner', 'trades'] as const) {
      const pro = await makeUser(role)
      expect(await withServiceRole((tx) => proVerificationBlock(tx, pro))).toMatch(/verifying/)
      await db.update(profiles).set({ verificationStatus: 'pending' }).where(eq(profiles.userId, pro))
      expect(await withServiceRole((tx) => proVerificationBlock(tx, pro))).toMatch(/verifying/)
      await db.update(profiles).set({ verificationStatus: 'verified' }).where(eq(profiles.userId, pro))
      expect(await withServiceRole((tx) => proVerificationBlock(tx, pro))).toBeNull()
    }
  })
})

describe('client approval and weekly payout', () => {
  async function jobAwaitingReview() {
    const client = await makeUser('client')
    const clerk = await makeUser('clerk')
    const prop = await makeProperty(client)
    const [r] = await book(client, prop.id, ['CHECK_OUT'])
    await paid(r.jobId, client, r.plan.totalP, r.plan.proFeeP ?? 0)
    await db.update(jobs).set({ clerkId: clerk, status: 'submitted' }).where(eq(jobs.id, r.jobId))
    return { client, clerk, jobId: r.jobId }
  }
  const release = (jobId: string, reviewHours = 48) =>
    withServiceRole((tx) => releaseToClient(tx, { jobId, actorId: null, reviewHours, via: 'test' }))

  it('LISTD review opens the window and pays nobody', async () => {
    const { jobId } = await jobAwaitingReview()
    expect((await release(jobId)).ok).toBe(true)
    const j = await jobRow(jobId)
    expect(j.status).toBe('reviewed')
    expect(new Date(j.clientReviewDueAt!).getTime()).toBeGreaterThan(Date.now() + 47 * 3600_000)
    expect(j.payoutEligibleAt).toBeNull()
    const payable = await withServiceRole((tx) => payableJobs(tx))
    expect(payable.some((p) => p.jobId === jobId)).toBe(false)
  })

  it('a job cannot be approved before LISTD has reviewed it', async () => {
    const { jobId, client } = await jobAwaitingReview()
    const r = await withServiceRole((tx) => approveJob(tx, { jobId, mode: 'client', actorId: client }))
    expect(r).toMatchObject({ ok: false, code: 'not_ready' })
  })

  it('client approval makes it payable once, and the run cannot double-pay', async () => {
    const { jobId, client } = await jobAwaitingReview()
    await release(jobId)
    expect((await withServiceRole((tx) => approveJob(tx, { jobId, mode: 'client', actorId: client }))).ok).toBe(true)
    const j = await jobRow(jobId)
    expect(j.status).toBe('completed')
    expect(j.approvalMode).toBe('client')
    expect(j.payoutEligibleAt).toBeTruthy()
    // Approving twice does nothing.
    expect((await withServiceRole((tx) => approveJob(tx, { jobId, mode: 'client', actorId: client }))).ok).toBe(false)

    // Stand-in for the Stripe transfer: marks the escrow released, as the real one does.
    const paidOut: string[] = []
    const fake = async (id: string) => {
      paidOut.push(id)
      await db.update(escrowTransactions).set({ status: 'released' }).where(and(eq(escrowTransactions.jobId, id), eq(escrowTransactions.status, 'held')))
      return { released: true }
    }
    const first = await runWeeklyPayouts(fake)
    expect(paidOut).toContain(jobId)
    expect(first.paidCount).toBeGreaterThan(0)
    paidOut.length = 0
    await runWeeklyPayouts(fake)
    expect(paidOut).not.toContain(jobId)
  })

  it('a Pro without payouts set up stays payable for next week', async () => {
    const { jobId, client } = await jobAwaitingReview()
    await release(jobId)
    await withServiceRole((tx) => approveJob(tx, { jobId, mode: 'client', actorId: client }))
    await runWeeklyPayouts(async () => ({ released: false, reason: 'worker_not_onboarded' }))
    const payable = await withServiceRole((tx) => payableJobs(tx))
    expect(payable.some((p) => p.jobId === jobId)).toBe(true)
  })

  it('auto-completes when the window closes, recorded as AUTO', async () => {
    const { jobId } = await jobAwaitingReview()
    await release(jobId)
    await db.update(jobs).set({ clientReviewDueAt: new Date(Date.now() - 1000).toISOString() }).where(eq(jobs.id, jobId))
    await autoApproveDueJobs()
    const j = await jobRow(jobId)
    expect(j.status).toBe('completed')
    expect(j.approvalMode).toBe('auto')
  })

  it('does not auto-complete before the window closes', async () => {
    const { jobId } = await jobAwaitingReview()
    await release(jobId)
    await autoApproveDueJobs()
    expect((await jobRow(jobId)).status).toBe('reviewed')
  })

  it('a dispute stops the clock, blocks approval and freezes payout; settling gives a fresh window', async () => {
    const { jobId, client, clerk } = await jobAwaitingReview()
    await release(jobId)
    const [d] = await db.insert(disputes).values({ jobId, raisedBy: client, raisedAgainst: clerk, reason: 'Missing rooms' }).returning()
    await withServiceRole((tx) => pauseReviewForDispute(tx, jobId))
    expect((await jobRow(jobId)).clientReviewDueAt).toBeNull()
    expect(await withServiceRole((tx) => approveJob(tx, { jobId, mode: 'client', actorId: client }))).toMatchObject({ ok: false, code: 'disputed' })
    await db.update(disputes).set({ status: 'resolved' }).where(eq(disputes.id, d.id))
    await withServiceRole((tx) => resumeReviewAfterDispute(tx, jobId, 48))
    expect((await jobRow(jobId)).clientReviewDueAt).toBeTruthy()
    expect((await withServiceRole((tx) => approveJob(tx, { jobId, mode: 'client', actorId: client }))).ok).toBe(true)
  })

  it('an open dispute after approval freezes the payout', async () => {
    const { jobId, client, clerk } = await jobAwaitingReview()
    await release(jobId)
    await withServiceRole((tx) => approveJob(tx, { jobId, mode: 'client', actorId: client }))
    await db.insert(disputes).values({ jobId, raisedBy: client, raisedAgainst: clerk, reason: 'Late complaint' })
    const payable = await withServiceRole((tx) => payableJobs(tx))
    expect(payable.some((p) => p.jobId === jobId)).toBe(false)
  })

  it('corrections go back to the Pro and clear the window', async () => {
    const { jobId, client } = await jobAwaitingReview()
    await release(jobId)
    expect((await withServiceRole((tx) => requestCorrection(tx, { jobId, actorId: client, text: 'Bedroom 2 is missing' }))).ok).toBe(true)
    const j = await jobRow(jobId)
    expect(j.status).toBe('in_progress')
    expect(j.clientReviewDueAt).toBeNull()
  })
})

describe('quotes and change orders', () => {
  const lines: QuoteLine[] = [
    { d: 'Labour: replace tap', q: 1, u: 8000, tag: 'svc' },
    { d: 'Materials', q: 1, u: 2000, tag: 'materials' },
  ]
  async function repairJob(scope = { repairMode: 'fixed' as const }) {
    const client = await makeUser('client')
    const prop = await makeProperty(client)
    const [r] = await book(client, prop.id, ['REPAIRS_DAMAGES'], scope)
    return { client, jobId: r.jobId }
  }

  it('issue, accept, then awaiting payment; repair fee is labour share + materials', async () => {
    const { client, jobId } = await repairJob()
    const q = await withServiceRole((tx) => issueQuote(tx, pr, { jobId, lines, actorId: null }))
    expect(q).toMatchObject({ ok: true, quote: { version: 1, totalP: 10000, proFeeP: 6000 + 2000 } })
    expect((await withServiceRole((tx) => acceptQuote(tx, { jobId, actorId: client }))).ok).toBe(true)
    expect((await jobRow(jobId)).status).toBe('draft')
  })

  it('a booking with no upfront charge can record its quote; a manual quote on a live job cannot', async () => {
    const { jobId } = await repairJob()
    await db.update(jobs).set({ status: 'published' }).where(eq(jobs.id, jobId))
    expect(await withServiceRole((tx) => issueQuote(tx, pr, { jobId, lines, actorId: null }))).toMatchObject({ ok: false })
    const auto = await withServiceRole((tx) => issueQuote(tx, pr, { jobId, lines, actorId: null, auto: true, status: 'ACCEPTED' }))
    expect(auto).toMatchObject({ ok: true })
    expect((await jobRow(jobId)).status).toBe('published')
  })

  it('an updated quote needs a reason, supersedes the old one and must be accepted again', async () => {
    const { client, jobId } = await repairJob()
    await withServiceRole((tx) => issueQuote(tx, pr, { jobId, lines, actorId: null }))
    await withServiceRole((tx) => acceptQuote(tx, { jobId, actorId: client }))
    expect(await withServiceRole((tx) => issueQuote(tx, pr, { jobId, lines, actorId: null }))).toMatchObject({ ok: false })
    const v2 = await withServiceRole((tx) => issueQuote(tx, pr, { jobId, lines, why: 'Parts cost more', actorId: null }))
    expect(v2).toMatchObject({ ok: true, quote: { version: 2 } })
    const all = await db.select().from(jobQuotes).where(eq(jobQuotes.jobId, jobId))
    expect(all.find((q) => q.version === 1)?.status).toBe('SUPERSEDED')
    expect((await jobRow(jobId)).status).toBe('pending')
  })

  it('no updated quote once paid', async () => {
    const { client, jobId } = await repairJob()
    await withServiceRole((tx) => issueQuote(tx, pr, { jobId, lines, actorId: null }))
    await paid(jobId, client, 10000, 8000)
    expect(await withServiceRole((tx) => issueQuote(tx, pr, { jobId, lines, why: 'x', actorId: null }))).toMatchObject({ ok: false })
  })

  it('an expired quote cannot be accepted; a declined one is closed', async () => {
    const { client, jobId } = await repairJob()
    await withServiceRole((tx) => issueQuote(tx, pr, { jobId, lines, actorId: null }))
    const later = new Date(Date.now() + 8 * 86_400_000)
    expect(await withServiceRole((tx) => acceptQuote(tx, { jobId, actorId: client }, later))).toMatchObject({ ok: false, error: expect.stringMatching(/expired/) })
    expect(await expireQuotes(later)).toBeGreaterThan(0)
    const second = await repairJob()
    await withServiceRole((tx) => issueQuote(tx, pr, { jobId: second.jobId, lines, actorId: null }))
    expect((await withServiceRole((tx) => declineQuote(tx, { jobId: second.jobId, actorId: second.client, reason: 'Too much' }))).ok).toBe(true)
  })

  it('a diagnosis fee is credited once, against the first priced change order', async () => {
    const client = await makeUser('client')
    const trades = await makeUser('trades')
    const prop = await makeProperty(client)
    const [r] = await book(client, prop.id, ['REPAIRS_DAMAGES'], { repairMode: 'diagnose' })
    expect(r.plan.totalP).toBe(5000)
    expect(r.plan.mode).toBe('pay')
    await db.update(jobs).set({ status: 'in_progress', clerkId: trades }).where(eq(jobs.id, r.jobId))
    const first = await withServiceRole((tx) => proposeChangeOrder(tx, { jobId: r.jobId, proId: trades, description: 'Replace boiler valve' }))
    const second = await withServiceRole((tx) => proposeChangeOrder(tx, { jobId: r.jobId, proId: trades, description: 'Replace tap' }))
    if (!first.ok || !second.ok) throw new Error('proposal failed')
    const a = await withServiceRole((tx) => priceChangeOrder(tx, pr, { id: first.id, lines, actorId: trades }))
    const b = await withServiceRole((tx) => priceChangeOrder(tx, pr, { id: second.id, lines, actorId: trades }))
    expect(a).toMatchObject({ ok: true, creditP: 5000, totalP: 5000 })
    expect(b).toMatchObject({ ok: true, creditP: 0, totalP: 10000 })
    expect((await withServiceRole((tx) => decideChangeOrder(tx, { id: first.id, approve: true, actorId: client }))).ok).toBe(true)
    const [row] = await db.select().from(changeOrders).where(eq(changeOrders.id, first.id))
    expect(row.status).toBe('APPROVED')
  })

  it('only the assigned Pro can propose extra work', async () => {
    const { jobId } = await repairJob()
    const other = await makeUser('trades')
    expect(await withServiceRole((tx) => proposeChangeOrder(tx, { jobId, proId: other, description: 'Nope' }))).toMatchObject({ ok: false })
  })
})

describe('levels, standards check and training', () => {
  it('new Pros start at Level 1 with the standards check open, and can pass it early', async () => {
    const pro = await makeUser('clerk')
    await withServiceRole(async (tx) => {
      expect(await getProLevel(tx, pro, 'CLERK')).toBe(1)
      expect(await standardsCheck(tx, pro, 'CLERK')).toMatchObject({ passed: false, label: 'New to LISTD · job 1 of 5' })
    })
    await db.insert(proRoleLevels).values({ userId: pro, role: 'CLERK', standardsPassedAt: new Date().toISOString() })
    await withServiceRole(async (tx) => {
      expect(await standardsCheck(tx, pro, 'CLERK')).toMatchObject({ passed: true })
    })
  })

  it('cannot apply without the jobs, rating and standards check', async () => {
    const pro = await makeUser('clerk')
    const r = await withServiceRole((tx) => applyForLevel(tx, pro, 'CLERK', 2))
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.blockers.join(' ')).toMatch(/10 completed jobs/)
      expect(r.blockers.join(' ')).toMatch(/standards check/)
    }
    const skip = await withServiceRole((tx) => levelRequirements(tx, pro, 'CLERK', 3))
    expect(skip.blockers.join(' ')).toMatch(/Level 2 next/)
  })

  it('required training has no override, even for an admin', async () => {
    const pro = await makeUser('cleaner')
    const [t] = await db
      .insert(trainings)
      .values({ title: 'Deep clean standards', kind: 'link', url: 'https://example.com/t', role: 'CLEANER', level: 2, status: 'PUBLISHED' })
      .returning()
    created.trainings.push(t.id)
    const blocked = await withServiceRole((tx) => setProLevel(tx, { userId: pro, role: 'CLEANER', level: 2, actorId: pro, reason: 'Experienced' }))
    expect(blocked).toMatchObject({ ok: false, error: expect.stringMatching(/Deep clean standards/) })
    await db.insert(trainingCompletions).values({ trainingId: t.id, userId: pro })
    expect((await withServiceRole((tx) => setProLevel(tx, { userId: pro, role: 'CLEANER', level: 2, actorId: pro, reason: 'Experienced' }))).ok).toBe(true)
    await db.update(trainings).set({ status: 'ARCHIVED' }).where(eq(trainings.id, t.id))
  })

  it('an admin decides an application only once', async () => {
    const pro = await makeUser('clerk')
    const { levelApplications } = schema
    const [a] = await db.insert(levelApplications).values({ userId: pro, role: 'CLERK', fromLevel: 1, toLevel: 2 }).returning()
    expect((await withServiceRole((tx) => decideLevelApplication(tx, { id: a.id, actorId: pro, approve: true, reason: 'Meets the rules' }))).ok).toBe(true)
    await withServiceRole(async (tx) => expect(await getProLevel(tx, pro, 'CLERK')).toBe(2))
    expect(await withServiceRole((tx) => decideLevelApplication(tx, { id: a.id, actorId: pro, approve: false, reason: 'x y z' }))).toMatchObject({ ok: false })
  })
})

describe('portfolio', () => {
  it('earns a rebate at 10 completed jobs in a month', async () => {
    const client = await makeUser('client')
    const prop = await makeProperty(client)
    const month = new Date().toISOString().slice(0, 7)
    for (let i = 0; i < 10; i++) {
      const [r] = await book(client, prop.id, ['CHECK_OUT'])
      await db.update(jobs).set({ status: 'completed', approvedAt: new Date().toISOString(), clerkPayout: '40' }).where(eq(jobs.id, r.jobId))
    }
    const s = await withServiceRole((tx) => clientPortfolio(tx, pr, client, month))
    expect(s.tier).toBe('rebate')
    expect(s.count).toBe(10)
    // 5% of 10 x £110, each within its floor.
    expect(s.rebateP).toBe(5500)
  })
})
