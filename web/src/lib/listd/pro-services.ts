/**
 * One Pro account, any mix of services. Each service a Pro picks is held as
 * the matching app role, so job matching, levels and verification work per
 * service while the Pro has one sign-up, one onboarding and one dashboard.
 * Pure: safe in the browser (sign-up, onboarding) and on the server.
 */

export type ProServiceRole = 'clerk' | 'cleaner' | 'trades'

export const PRO_SERVICES: ReadonlyArray<{ role: ProServiceRole; label: string; hint: string }> = [
  { role: 'clerk', label: 'Inspections', hint: 'Inventories, check-ins, mid-terms and check-outs' },
  { role: 'cleaner', label: 'Cleaning', hint: 'Standard, deep, end of tenancy and office cleans' },
  { role: 'trades', label: 'Repairs & maintenance', hint: 'Handyman, fixes and small works' },
]

export const PRO_SERVICE_ROLES: readonly ProServiceRole[] = PRO_SERVICES.map((s) => s.role)

export function isProServiceRole(v: unknown): v is ProServiceRole {
  return typeof v === 'string' && (PRO_SERVICE_ROLES as readonly string[]).includes(v)
}

export function isPro(roles: readonly string[]): boolean {
  return roles.some((r) => isProServiceRole(r))
}

export function proServicesOf(roles: readonly string[]): ProServiceRole[] {
  return PRO_SERVICE_ROLES.filter((r) => roles.includes(r))
}
