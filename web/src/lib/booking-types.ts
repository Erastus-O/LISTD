import type {
  FurnishedStatus,
  PropertySize,
  ServiceTier,
} from './pricing-matrix'

/**
 * Shared booking-flow types (port of the relevant slices of Lovable's
 * `src/pages/BookJob.tsx` state). The orchestrator at
 * [Listd-NEXT/src/app/book/booking-flow.tsx](../app/book/booking-flow.tsx)
 * holds a `BookingFlowState` and walks through the steps below.
 */

export type BookingStep =
  | 'inspection'
  | 'tier'
  | 'size'
  | 'date'
  | 'tenant'
  | 'review'

export const ALL_BOOKING_STEPS: ReadonlyArray<{
  key: BookingStep
  label: string
}> = [
  { key: 'inspection', label: 'Service' },
  { key: 'tier', label: 'Tier' },
  // Size/furnishing (+ price) and property selection share one step.
  { key: 'size', label: 'Property' },
  { key: 'date', label: 'Schedule' },
  { key: 'tenant', label: 'Tenant' },
  { key: 'review', label: 'Review' },
]

export type TenantData = {
  fullName: string
  email: string
  phone: string
}

export type BookingFlowState = {
  step: BookingStep
  // Step 1 — built-in or admin-defined service keys.
  inspectionTypes: string[]
  // Step 2
  tier: ServiceTier
  tierAcknowledged: boolean
  // Step 3 — size/furnishing and the chosen property live on one step.
  size: PropertySize
  furnishing: FurnishedStatus
  propertyId: string | null
  // Step 4
  scheduledDate: string | null
  scheduledTimeSlot: string | null
  // Step 6 — one or more tenants (index 0 is the primary).
  tenants: TenantData[]
  /** Set when the client confirms there's no tenant yet — the only way to
   *  publish without at least one named tenant. */
  noTenantConfirmed: boolean
  // Step 7
  specialInstructions: string
  detailsConfirmed: boolean
  policyAcknowledged: boolean
}

export const INITIAL_BOOKING_STATE: BookingFlowState = {
  step: 'inspection',
  inspectionTypes: [],
  tier: 'core',
  tierAcknowledged: false,
  size: '2_bed',
  furnishing: 'unfurnished',
  propertyId: null,
  scheduledDate: null,
  scheduledTimeSlot: null,
  tenants: [{ fullName: '', email: '', phone: '' }],
  noTenantConfirmed: false,
  specialInstructions: '',
  detailsConfirmed: false,
  policyAcknowledged: false,
}
