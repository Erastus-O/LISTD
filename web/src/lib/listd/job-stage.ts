/**
 * The design's job stages, mapped from the `job_status` values in the shared
 * database. The stored values are unchanged; this is presentation only.
 *
 * What each status means:
 *   pending          waiting for LISTD's fixed quote
 *   draft            quote accepted or price fixed, payment not yet secured
 *                    (the Stripe webhook flips draft to published)
 *   published        paid and open to Pros
 *   accepted/assigned  a Pro has it
 *   in_progress      on site; also where corrections go back to
 *   submitted        LISTD is reviewing the work
 *   reviewed         the client's approval window is open
 *   signed           older jobs: client signed before approval replaced this
 *   completed        approved by the client (or the window closed); payout eligible
 *   paid             as completed, Pro paid
 */
export type StageTone = 'booked' | 'accepted' | 'progress' | 'awaiting' | 'signed' | 'disputed' | 'muted'

export type JobStage = {
  label: string
  tone: StageTone
  /** Index into STAGES for the progress rail; -1 when the rail doesn't apply. */
  step: number
}

export const STAGES = ['Booked', 'Accepted', 'In progress', 'LISTD review', 'Ready to approve', 'Approved'] as const

const MAP: Record<string, JobStage> = {
  pending: { label: 'Awaiting quote', tone: 'booked', step: -1 },
  draft: { label: 'Awaiting payment', tone: 'awaiting', step: -1 },
  published: { label: 'Booked · Finding a Pro', tone: 'booked', step: 0 },
  accepted: { label: 'Accepted', tone: 'accepted', step: 1 },
  assigned: { label: 'Accepted', tone: 'accepted', step: 1 },
  in_progress: { label: 'In progress', tone: 'progress', step: 2 },
  submitted: { label: 'LISTD review', tone: 'progress', step: 3 },
  reviewed: { label: 'Ready to approve', tone: 'awaiting', step: 4 },
  signed: { label: 'Approved', tone: 'signed', step: 5 },
  completed: { label: 'Approved', tone: 'signed', step: 5 },
  paid: { label: 'Approved', tone: 'signed', step: 5 },
  cancelled: { label: 'Cancelled', tone: 'muted', step: -1 },
}

export function jobStage(status: string): JobStage {
  return MAP[status] ?? { label: status.replace(/_/g, ' '), tone: 'muted', step: -1 }
}

export type ServiceStyle = { key: string; label: string; icon: string }

/** Service colour + icon for an `inspection_type` value (including clean_* types). */
export function serviceStyle(type: string, fallbackLabel?: string): ServiceStyle {
  if (type === 'repairs') {
    return { key: 'repairs', label: fallbackLabel ?? 'Repairs & Maintenance', icon: 'settings' }
  }
  if (type.startsWith('clean')) {
    return { key: 'cleaning', label: fallbackLabel ?? 'Cleaning', icon: 'cleaning' }
  }
  switch (type) {
    case 'new_inventory':
      return { key: 'inventory', label: 'Inventory', icon: 'inventory' }
    case 'check_in':
      return { key: 'checkin', label: 'Check-In', icon: 'check-in' }
    case 'check_out':
      return { key: 'checkout', label: 'Check-Out', icon: 'check-out' }
    case 'mid_term':
    case 'interim':
      return { key: 'midterm', label: type === 'interim' ? 'Interim' : 'Mid-Term', icon: 'inspection' }
    default:
      // Admin-defined service types from the rate card.
      return { key: 'inventory', label: fallbackLabel ?? type.replace(/_/g, ' '), icon: 'inventory' }
  }
}
