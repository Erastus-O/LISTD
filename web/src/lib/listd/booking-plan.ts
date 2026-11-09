import {
  coverageBlock,
  dateBlock,
  isoDay,
  schedForDate,
  type PricedProperty,
  type Pricing,
  type Sched,
  type ServiceKey,
} from './pricing'
import { SERVICE_LABEL, isSameVisit, planService, type BookingScope, type ServicePlan } from './services'

/**
 * Validates coverage and date, and prices each service. Pure: the booking wizard
 * calls this for its live preview and the server calls it again to charge, so
 * what a client sees is what they pay.
 */
export type BookingRequest = {
  services: ServiceKey[]
  sameVisit?: boolean
  scope?: BookingScope
  scheduledDate: string
  today?: string
}

export type BookingPlan = {
  sched: Sched
  sameVisit: boolean
  plans: ServicePlan[]
  /** Total payable now, in pence: services with a fixed price. */
  payNowP: number
}

export function planBooking(
  pr: Pricing,
  property: PricedProperty & { postcode: string | null },
  req: BookingRequest
): { ok: true; plan: BookingPlan } | { ok: false; error: string } {
  const services = [...new Set(req.services)]
  if (!services.length) return { ok: false, error: 'Choose at least one service.' }
  for (const s of services) {
    const block = coverageBlock(property.postcode, s, SERVICE_LABEL[s])
    if (block) return { ok: false, error: block }
  }
  const today = req.today ?? isoDay(new Date())
  const blocked = dateBlock(pr, req.scheduledDate, today)
  if (blocked) return { ok: false, error: blocked }

  const sched = schedForDate(pr, req.scheduledDate, today)
  const sameVisit = isSameVisit(services, req.sameVisit)
  const plans = services.map((service) =>
    planService(pr, service, property, {
      sched,
      sameVisit: sameVisit && (service === 'INVENTORY' || service === 'CHECK_IN'),
      scope: req.scope,
    })
  )
  return {
    ok: true,
    plan: {
      sched,
      sameVisit,
      plans,
      payNowP: plans.filter((p) => p.mode === 'pay').reduce((a, p) => a + p.totalP, 0),
    },
  }
}
