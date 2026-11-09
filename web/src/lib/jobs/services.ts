import { INSPECTION_TYPE_LABELS } from '@/lib/pricing-matrix'

/**
 * A booking can bundle several services onto ONE job — "Inventory +
 * Check-In" is the common pair (see `/api/jobs/create`, which writes the
 * whole selection to `jobs.inspection_types` and copies the first into the
 * legacy single-column `jobs.inspection_type`).
 *
 * Every screen used to print only the single column, so a bundled
 * check-in never appeared anywhere: the Pro saw "New Inventory", accepted,
 * and only found out on site that a tenant hand-over was also expected.
 * These helpers make the whole bundle the thing that gets rendered.
 *
 * Legacy rows (pre-array) fall back to the single type, so nothing renders
 * blank.
 */

/** Every service key on the job, primary first, de-duplicated. */
export function jobServiceKeys(job: {
  inspectionType: string
  inspectionTypes?: string[] | null
}): string[] {
  const all = [job.inspectionType, ...(job.inspectionTypes ?? [])]
    .map((t) => (t ?? '').trim())
    .filter(Boolean)
  return Array.from(new Set(all))
}

/** Human labels for every service on the job. */
export function jobServiceLabels(job: {
  inspectionType: string
  inspectionTypes?: string[] | null
}): string[] {
  return jobServiceKeys(job).map(
    (key) => INSPECTION_TYPE_LABELS[key as keyof typeof INSPECTION_TYPE_LABELS] ?? key
  )
}

/** One-line summary: "New Inventory + Check-In". */
export function jobServiceSummary(job: {
  inspectionType: string
  inspectionTypes?: string[] | null
}): string {
  const labels = jobServiceLabels(job)
  return labels.length > 0 ? labels.join(' + ') : job.inspectionType
}

/** True when the job carries more than one service. */
export function isBundledJob(job: {
  inspectionType: string
  inspectionTypes?: string[] | null
}): boolean {
  return jobServiceKeys(job).length > 1
}

/**
 * Services that can't be done without the tenant physically present, so
 * the Pro has to agree a time with them rather than just turning up.
 * Drives the "you'll need to book this with the tenant" prompt.
 */
const TENANT_PRESENT_SERVICES = new Set(['check_in', 'check_out'])

/** Service keys on this job that need a tenant appointment. */
export function tenantAppointmentServices(job: {
  inspectionType: string
  inspectionTypes?: string[] | null
}): string[] {
  return jobServiceKeys(job).filter((k) => TENANT_PRESENT_SERVICES.has(k))
}

/** Human labels for the tenant-present services, for prompt copy. */
export function tenantAppointmentLabels(job: {
  inspectionType: string
  inspectionTypes?: string[] | null
}): string[] {
  return tenantAppointmentServices(job).map(
    (key) => INSPECTION_TYPE_LABELS[key as keyof typeof INSPECTION_TYPE_LABELS] ?? key
  )
}
