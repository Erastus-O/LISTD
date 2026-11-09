import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { created, errorResponse, forbidden } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import {
  notifications,
  organisationMembers,
  properties,
  withServiceRole,
} from '@/db'
import { callerIp, callerUserAgent, logAuditEvent } from '@/lib/audit'
import {
  createEscrowCheckoutForJobs,
  isStripeConfigured,
} from '@/lib/billing/escrow'
import { createBookingJobs, planBooking } from '@/lib/listd/booking'
import { eligibleFeeP, type ServiceKey } from '@/lib/listd/pricing'
import { getPricing } from '@/lib/listd/pricing-settings'
import { SERVICE_LABEL, toPricedProperty } from '@/lib/listd/services'
import { logApp } from '@/lib/logging/logger'
import { notifyMatchingProvidersOnPublish } from '@/lib/notify/job-fanout'
import {
  deliverOwnerPaymentLink,
  resolveOrgPaymentContext,
} from '@/lib/billing/worker-post-payment'
import {
  computePromoDiscount,
  findUsablePromo,
  redeemPromo,
  type PromoRecord,
} from '@/lib/promo'

export const maxDuration = 15
export const runtime = 'nodejs'

const TenantSchema = z
  .object({
    fullName: z.string().trim().max(100),
    email: z.string().trim().max(200),
    phone: z.string().trim().max(50),
  })
  .partial({ email: true, phone: true })

const ScopeSchema = z
  .object({
    clean: z.enum(['standard', 'deep', 'eot', 'office']).optional(),
    condition: z.enum(['vacant-tidy', 'vacant-dirty', 'occupied']).optional(),
    addons: z.array(z.enum(['oven', 'fridge', 'cupboards', 'carpets', 'windowsOut'])).optional(),
    carpetRooms: z.number().int().min(1).max(30).optional(),
    areaM2: z.number().int().min(1).max(100000).optional(),
    frequency: z.string().trim().max(100).optional(),
    facilities: z.string().trim().max(500).optional(),
    repairMode: z.enum(['diagnose', 'fixed']).optional(),
    category: z.string().trim().max(100).optional(),
    location: z.string().trim().max(200).optional(),
    description: z.string().trim().max(2000).optional(),
    severity: z.string().trim().max(50).optional(),
  })
  .strict()

const RequestSchema = z.object({
  propertyId: z.string().uuid(),
  services: z
    .array(z.enum(['INVENTORY', 'CHECK_IN', 'MID_TERM', 'CHECK_OUT', 'REPAIRS_DAMAGES', 'CLEANING']))
    .min(1)
    .max(6),
  /** Inventory + check-in on one visit share the combined price. Default true. */
  sameVisit: z.boolean().optional(),
  scope: ScopeSchema.optional(),
  scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  scheduledTimeSlot: z.string().min(1).max(40).optional().nullable(),
  specialInstructions: z.string().max(2000).optional(),
  tenants: z.array(TenantSchema).max(10).optional(),
  /** Client confirmed there's no tenant yet. Required to book an inspection
   *  without at least one named tenant. */
  noTenantConfirmed: z.boolean().optional(),
  /** ADMIN ONLY: book on behalf of this client. The job is owned by them,
   *  their property is used, and the payment link goes to their inbox + email
   *  instead of redirecting the admin to checkout. */
  onBehalfOfClientId: z.string().uuid().optional(),
  /** Promo code: 'discount' reduces the charge, 'invoice_later' bypasses
   *  payment at posting (debt swept into a month-end invoice). Re-validated
   *  and atomically redeemed here; the preview endpoint is not trusted. */
  promoCode: z.string().trim().max(40).optional(),
})

const NEEDS_TENANT: ServiceKey[] = ['INVENTORY', 'CHECK_IN', 'MID_TERM', 'CHECK_OUT']

/**
 * POST /api/jobs/create: book one or more services for a property.
 *
 * The server prices everything from the rate card (client-supplied prices are
 * never trusted) and refuses areas LISTD doesn't serve. One job is created per
 * service, linked by a group id:
 *   - inspections and diagnosis visits have a fixed price and go to one shared
 *     checkout; each publishes when the payment succeeds
 *   - cleaning, fixed repairs and custom sizes wait for a quote from LISTD
 *
 * The Pro's fee is provisional here: it's set from their level when they accept.
 */
export async function POST(req: Request) {
  const session = await authorizeRequest()
  if (session instanceof Response) return session

  try {
    const body = RequestSchema.parse(await req.json())
    const ip = callerIp(req)
    const ua = callerUserAgent(req)

    // Admin booking on behalf of a client: the job belongs to the client
    // (ownership checks + payment run against them); the admin is recorded
    // as the creator. Non-admins cannot impersonate.
    const isAdmin = session.roles.includes('admin')
    if (body.onBehalfOfClientId && !isAdmin) {
      return forbidden('Only admins can book on behalf of a client.')
    }
    const effectiveClientId = body.onBehalfOfClientId ?? session.userId
    const onBehalf = Boolean(body.onBehalfOfClientId)

    // Every inspection needs a named tenant, unless the client confirmed there
    // isn't one yet.
    const hasNamedTenant = (body.tenants ?? []).some((t) => t.fullName?.trim())
    if (body.services.some((s) => NEEDS_TENANT.includes(s)) && !hasNamedTenant && !body.noTenantConfirmed) {
      return Response.json(
        { error: 'Add at least one tenant, or confirm there is no tenant yet.' },
        { status: 400 }
      )
    }

    // 1) Validate the property belongs to the caller (or their org).
    const propertyOwnership = await withServiceRole(async (tx) => {
      const [prop] = await tx
        .select()
        .from(properties)
        .where(eq(properties.id, body.propertyId))
        .limit(1)
      if (!prop) return { ok: false as const, reason: 'not_found' }

      // The (effective) client's active org membership. Used to roll a
      // personal-property booking (one the member created with no
      // organisation_id) up under their org, so org-wide dashboards /
      // statements include it. Without this, an org owner's own bookings are
      // invisible to the org-scoped dashboard (they only carried client_id).
      // For admin on-behalf bookings this is the TARGET client's membership.
      const [callerMembership] = await tx
        .select({ organisationId: organisationMembers.organisationId })
        .from(organisationMembers)
        .where(
          and(
            eq(organisationMembers.userId, effectiveClientId),
            eq(organisationMembers.status, 'active')
          )
        )
        .limit(1)
      const callerOrgId = callerMembership?.organisationId ?? null

      if (prop.clientId === effectiveClientId) {
        return { ok: true as const, prop, organisationId: prop.organisationId ?? callerOrgId }
      }
      // Org-shared property: check the (effective) client is a member.
      if (prop.organisationId) {
        const [membership] = await tx
          .select({ id: organisationMembers.id })
          .from(organisationMembers)
          .where(
            and(
              eq(organisationMembers.userId, effectiveClientId),
              eq(organisationMembers.organisationId, prop.organisationId),
              eq(organisationMembers.status, 'active')
            )
          )
          .limit(1)
        if (membership) {
          return { ok: true as const, prop, organisationId: prop.organisationId }
        }
      }
      return { ok: false as const, reason: 'forbidden' }
    })

    if (!propertyOwnership.ok) {
      if (propertyOwnership.reason === 'not_found') {
        return Response.json({ error: 'Property not found' }, { status: 404 })
      }
      return forbidden('You do not have access to this property.')
    }

    // 2) Price it from the rate card. Don't trust the client.
    const pricing = await getPricing()
    const { prop } = propertyOwnership
    const planned = planBooking(
      pricing,
      { ...toPricedProperty(prop), postcode: prop.postcode },
      {
        services: body.services,
        sameVisit: body.sameVisit,
        scope: body.scope,
        scheduledDate: body.scheduledDate,
      }
    )
    if (!planned.ok) {
      return Response.json({ error: planned.error }, { status: 400 })
    }
    const { plan } = planned

    // Promo code (0035). 'discount' takes percent_off off eligible service
    // lines on the fixed-price services; 'invoice_later' skips payment at
    // posting entirely. Invalid codes fail the booking with the reason rather
    // than silently charging full price.
    let promo: PromoRecord | null = null
    if (body.promoCode) {
      // Assignment check runs against the job's OWNER (the on-behalf client
      // for admin bookings): private codes belong to the client, not the
      // person driving the form.
      const lookup = await findUsablePromo(body.promoCode, {
        forClientId: effectiveClientId,
      })
      if (!lookup.ok) {
        return Response.json({ error: lookup.error }, { status: 400 })
      }
      promo = lookup.promo
    }
    const discountsPence = new Map<ServiceKey, number>()
    if (promo) {
      for (const sp of plan.plans) {
        if (sp.mode !== 'pay') continue
        const pounds = computePromoDiscount(promo, [
          { type: sp.inspectionType, price: eligibleFeeP(sp.lines) / 100 },
        ])
        if (pounds > 0) discountsPence.set(sp.service, Math.round(pounds * 100))
      }
    }
    const invoiceLater = promo?.kind === 'invoice_later'

    // Payment: when Stripe is configured the client pays before fixed-price
    // jobs go live. Invoice-later promo bookings skip it by design: publish
    // now, invoice at month end.
    const requirePayment = isStripeConfigured() && !invoiceLater

    // Consume the redemption before writing the job: atomic against the cap, so
    // two racing bookings can't both take the last slot. (If the insert below
    // then fails, one count leaks; harmless vs over-redeeming.)
    if (promo) {
      const redeemed = await redeemPromo(promo.id)
      if (!redeemed) {
        return Response.json(
          { error: 'That promo code has been fully redeemed.' },
          { status: 400 }
        )
      }
    }

    const createdJobs = await withServiceRole(async (tx) => {
      const rows = await createBookingJobs(tx, pricing, {
        plan,
        propertyId: body.propertyId,
        clientId: effectiveClientId,
        createdByUserId: session.userId,
        organisationId: propertyOwnership.organisationId ?? null,
        scheduledDate: body.scheduledDate,
        scheduledTimeSlot: body.scheduledTimeSlot,
        specialInstructions: body.specialInstructions,
        scope: body.scope,
        requirePayment,
        tenants: body.tenants,
        promo: promo ? { id: promo.id, kind: promo.kind, discountsPence } : null,
        ip,
        ua,
      })
      if (!requirePayment) {
        for (const r of rows.filter((x) => x.plan.mode === 'pay')) {
          await logAuditEvent(tx, {
            category: 'job_lifecycle',
            action: 'job.published',
            actorUserId: session.userId,
            targetType: 'job',
            targetId: r.jobId,
            payload: { priorStatus: 'draft', autoPublished: true },
            ipAddress: ip,
            userAgent: ua,
          })
        }
      }
      return rows
    })
    const payable = createdJobs.filter((r) => r.plan.mode === 'pay' && r.plan.totalP > 0)
    const firstId = createdJobs[0].jobId

    // 3) Resolve the org's worker-post payment context once: it decides both
    //    whether owners get a payment link and whether we send the generic
    //    "worker posted" heads-up.
    const orgCtx = propertyOwnership.organisationId
      ? await resolveOrgPaymentContext(propertyOwnership.organisationId, session.userId)
      : null
    const useOwnerLink =
      requirePayment &&
      !!orgCtx?.callerIsWorker &&
      orgCtx.mode === 'owner_link' &&
      !!orgCtx.primaryOwnerId

    if (orgCtx?.callerIsWorker && orgCtx.ownerIds.length > 0 && !useOwnerLink) {
      try {
        await withServiceRole((tx) =>
          tx.insert(notifications).values(
            orgCtx.ownerIds.map((userId) => ({
              userId,
              type: 'job',
              title: 'Worker made a booking',
              message: `A team member just made booking ${firstId.slice(0, 8)} on behalf of your organisation.`,
              link: `/client/jobs/${firstId}`,
            }))
          )
        )
      } catch (err) {
        console.warn('[jobs/create] worker-post notification failed:', err)
      }
    }

    await logApp(
      'job.created',
      'Booking created',
      {
        jobIds: createdJobs.map((r) => r.jobId),
        escrow: requirePayment,
        payNowP: plan.payNowP,
        sched: plan.sched,
        promoCode: promo?.code ?? null,
        promoKind: promo?.kind ?? null,
      },
      { actorUserId: session.userId, route: '/api/jobs/create' }
    )

    const summary = {
      jobs: createdJobs.map((r) => ({
        id: r.jobId,
        service: r.plan.service,
        mode: r.plan.mode,
        totalP: r.plan.totalP,
        reason: r.plan.reason,
      })),
      sched: plan.sched,
    }

    // No payment step: fixed-price jobs are already live, so notify Pros now.
    if (!requirePayment || payable.length === 0) {
      for (const r of createdJobs.filter((x) => x.plan.mode === 'pay')) {
        await notifyMatchingProvidersOnPublish(r.jobId)
      }
      return created({ ...summary, invoiceLater: invoiceLater || undefined })
    }

    // One checkout for everything with a fixed price. Jobs stay `draft` until
    // the webhook confirms the charge.
    const checkout = await createEscrowCheckoutForJobs({
      // Payer of record: the org owner under owner-link, the target client for
      // admin on-behalf bookings, else the poster.
      clientUserId:
        useOwnerLink && orgCtx?.primaryOwnerId ? orgCtx.primaryOwnerId : effectiveClientId,
      items: payable.map((r) => ({
        jobId: r.jobId,
        grossPounds: r.plan.totalP / 100,
        clerkPounds: (r.plan.proFeeP ?? 0) / 100,
        description: `LISTD ${SERVICE_LABEL[r.plan.service]}, ${prop.postcode}`,
      })),
    })

    if (onBehalf || useOwnerLink) {
      // Admin booked for the client, or a worker's post under owner-link: send
      // the secure payment link to whoever pays (in-app + email). The jobs
      // publish once they pay.
      await deliverOwnerPaymentLink({
        ownerIds: onBehalf ? [effectiveClientId] : orgCtx!.ownerIds,
        jobId: payable[0].jobId,
        checkoutUrl: checkout.url,
        serviceLabel: payable.map((r) => SERVICE_LABEL[r.plan.service]).join(', '),
        amountPounds: plan.payNowP / 100,
        posterName: onBehalf
          ? 'LISTD (booked for you by our team)'
          : (session.profile?.fullName ?? 'A team member'),
      })
      return created({
        ...summary,
        ...(onBehalf ? { clientPaymentPending: true } : { ownerPaymentPending: true }),
      })
    }

    return created({ ...summary, checkoutUrl: checkout.url })
  } catch (err) {
    console.error('[jobs/create] error:', err)
    return errorResponse(err)
  }
}
