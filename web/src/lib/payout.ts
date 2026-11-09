/**
 * Resolve a clerk's effective payout for display / earnings.
 *
 * `jobs.clerk_final_payout` carries a DB `default '0'`, so a freshly created
 * job has `'0'` there — NOT null. That means the long-standing fallback
 * `clerkFinalPayout ?? clerkPayout` (which only guards null/undefined) keeps
 * the `'0'` and renders £0.00 even though the quoted `clerkPayout` is set.
 *
 * `clerk_final_payout` is only meaningful once an admin finalises / overrides
 * the payout (see the pricing-override + recompute-payouts routes, which both
 * treat `IS NULL OR = 0` as "not set"). Until then we fall back to the quoted
 * `clerkPayout`. This helper encodes that single rule for every read site.
 *
 * SQL aggregates use the equivalent `coalesce(nullif(final, 0), base, 0)`.
 */
export function effectiveClerkPayout(
  finalPayout: string | number | null | undefined,
  basePayout: string | number | null | undefined
): number {
  const final = Number(finalPayout ?? 0)
  if (Number.isFinite(final) && final > 0) return final
  const base = Number(basePayout ?? 0)
  return Number.isFinite(base) ? base : 0
}
