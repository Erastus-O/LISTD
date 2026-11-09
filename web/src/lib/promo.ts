import 'server-only'

import { desc, eq, sql } from 'drizzle-orm'
import { promoCodes, withServiceRole } from '@/db'

/**
 * Promo codes (migration 0035). Two kinds:
 *
 *   'discount'      — percent off the base price of the service types the
 *                     admin scoped the code to (empty scope = every service).
 *                     Payment still happens at booking, on the reduced total.
 *   'invoice_later' — the client bypasses payment at posting entirely. The
 *                     job publishes immediately; the debt accrues on their
 *                     dashboard and is swept into a consolidated invoice by
 *                     the month-end cron (`/api/cron/monthly-promo-billing`),
 *                     which also generates + emails the Stripe payment link
 *                     and nudges until paid.
 *
 * Validation is two-phase: `findUsablePromo` for read-only checks (booking
 * preview + create route), then `redeemPromo` — an atomic counter increment
 * that enforces `max_redemptions` under concurrency — once the job row is
 * actually being written.
 */

export type PromoKind = 'discount' | 'invoice_later'

export type PromoRecord = {
  id: string
  code: string
  kind: PromoKind
  percentOff: number | null
  serviceTypes: string[] | null
  startsAt: string | null
  expiresAt: string | null
  maxRedemptions: number | null
  redemptionCount: number
  enabled: boolean
  /** 0036 — non-empty = private: only these clients can use it, and it
   *  auto-applies on their bookings. NULL/empty = public. */
  assignedClientIds: string[] | null
}

export function normalizePromoCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, '')
}

export type PromoLookup =
  | { ok: true; promo: PromoRecord }
  | { ok: false; error: string }

const PROMO_COLUMNS = {
  id: promoCodes.id,
  code: promoCodes.code,
  kind: promoCodes.kind,
  percentOff: promoCodes.percentOff,
  serviceTypes: promoCodes.serviceTypes,
  startsAt: promoCodes.startsAt,
  expiresAt: promoCodes.expiresAt,
  maxRedemptions: promoCodes.maxRedemptions,
  redemptionCount: promoCodes.redemptionCount,
  enabled: promoCodes.enabled,
  assignedClientIds: promoCodes.assignedClientIds,
}

type PromoColumnsRow = {
  id: string
  code: string
  kind: string
  percentOff: number | null
  serviceTypes: string[] | null
  startsAt: string | null
  expiresAt: string | null
  maxRedemptions: number | null
  redemptionCount: number
  enabled: boolean
  assignedClientIds: string[] | null
}

/** Enabled + window + cap checks shared by lookup and auto-apply. */
function usabilityError(row: PromoColumnsRow): string | null {
  if (!row.enabled) return 'That promo code is no longer active.'
  const now = Date.now()
  if (row.startsAt && new Date(row.startsAt).getTime() > now) {
    return 'That promo code is not active yet.'
  }
  if (row.expiresAt && new Date(row.expiresAt).getTime() < now) {
    return 'That promo code has expired.'
  }
  if (
    row.maxRedemptions !== null &&
    row.redemptionCount >= row.maxRedemptions
  ) {
    return 'That promo code has been fully redeemed.'
  }
  return null
}

function toPromoRecord(row: PromoColumnsRow): PromoRecord {
  return {
    ...row,
    kind: row.kind === 'invoice_later' ? 'invoice_later' : 'discount',
  }
}

/**
 * Look the code up and run every read-only usability check: exists, enabled,
 * inside its validity window, redemptions left — and, for assigned (private)
 * codes, that `forClientId` is on the assignment list. Private codes read as
 * plain "not valid" to everyone else; their existence isn't leaked.
 * Defensive pre-migration — a missing table/column reads as "invalid code",
 * never a 500.
 */
export async function findUsablePromo(
  rawCode: string,
  opts?: { forClientId?: string | null }
): Promise<PromoLookup> {
  const code = normalizePromoCode(rawCode)
  if (!code) return { ok: false, error: 'Enter a promo code.' }

  const row = await withServiceRole((tx) =>
    tx
      .select(PROMO_COLUMNS)
      .from(promoCodes)
      .where(eq(promoCodes.code, code))
      .limit(1)
      .then((r) => r[0])
  ).catch(() => undefined)

  if (!row) return { ok: false, error: 'That promo code is not valid.' }
  if (
    row.assignedClientIds &&
    row.assignedClientIds.length > 0 &&
    (!opts?.forClientId || !row.assignedClientIds.includes(opts.forClientId))
  ) {
    return { ok: false, error: 'That promo code is not valid.' }
  }
  const err = usabilityError(row)
  if (err) return { ok: false, error: err }
  return { ok: true, promo: toPromoRecord(row) }
}

/**
 * The auto-apply code for a client, if any: the most recently created
 * USABLE code assigned to them. Booking pages prefill it on the review
 * step (still removable — removing it means paying normally). Returns null
 * pre-migration or when nothing is assigned.
 */
export async function findAutoApplyPromoForClient(
  clientUserId: string
): Promise<PromoRecord | null> {
  const rows = await withServiceRole((tx) =>
    tx
      .select(PROMO_COLUMNS)
      .from(promoCodes)
      .where(
        sql`${promoCodes.assignedClientIds} @> ARRAY[${clientUserId}]::uuid[]`
      )
      .orderBy(desc(promoCodes.createdAt))
      .limit(10)
      .then((r) => r)
  ).catch(() => [])

  for (const row of rows) {
    if (!usabilityError(row)) return toPromoRecord(row)
  }
  return null
}

/**
 * Percent-off discount, in pounds, for a 'discount' promo against the
 * booking's per-service base-price lines. Only lines whose service type is
 * inside the code's scope count (empty/NULL scope = all). Add-ons, urgency
 * surcharge and the platform fee are never discounted — the admin sets the
 * percentage "on each service type".
 */
export function computePromoDiscount(
  promo: PromoRecord,
  serviceLines: Array<{ type: string; price: number }>
): number {
  if (promo.kind !== 'discount') return 0
  const pct = Math.min(100, Math.max(0, promo.percentOff ?? 0))
  if (pct <= 0) return 0
  const scope =
    promo.serviceTypes && promo.serviceTypes.length > 0
      ? new Set(promo.serviceTypes)
      : null
  const eligible = serviceLines
    .filter((l) => !scope || scope.has(l.type))
    .reduce((sum, l) => sum + l.price, 0)
  return Math.round(eligible * pct) / 100
}

/**
 * Atomically consume one redemption. Returns false when the cap was hit by
 * a concurrent booking between validation and now — callers must treat that
 * as "code invalid" and abort.
 */
export async function redeemPromo(promoId: string): Promise<boolean> {
  const rows = await withServiceRole((tx) =>
    tx
      .update(promoCodes)
      .set({
        redemptionCount: sql`${promoCodes.redemptionCount} + 1`,
        updatedAt: new Date().toISOString(),
      })
      .where(
        sql`${promoCodes.id} = ${promoId} AND (${promoCodes.maxRedemptions} IS NULL OR ${promoCodes.redemptionCount} < ${promoCodes.maxRedemptions})`
      )
      .returning({ id: promoCodes.id })
  ).catch(() => [])
  return rows.length > 0
}
