'use client'

import type { RoomDraft } from '@/app/clerk/jobs/[jobId]/inspect/_components/room-section'

/**
 * localStorage persistence for the in-progress `/inspect` form. Saves
 * the form state as the clerk fills it in so a refresh, accidental
 * navigation, or idle-timeout sign-out doesn't lose the work. Mirrors
 * the booking-draft pattern in `src/lib/booking-draft.ts`.
 *
 * Versioned — bump `INSPECT_DRAFT_VERSION` and the loader returns null
 * instead of trying to coerce a mismatched payload.
 *
 * Photo URLs are persisted (just the strings — no bytes), but the
 * signed `previewUrl` expires after an hour. The form re-signs photos
 * after restore so thumbnails reappear.
 */

const STORAGE_PREFIX = 'listd:inspect-draft:'
const INSPECT_DRAFT_VERSION = 1

export type MeterDraft = {
  id: string
  label: string
  serialNumber: string
  value: string
  location: string
  supplier: string
}

export type InspectDraft = {
  rooms: RoomDraft[]
  generalNotes: string
  meters: MeterDraft[]
  smokeAlarmsChecked: boolean
  carbonMonoxideChecked: boolean
}

type Persisted = {
  v: number
  state: InspectDraft
  savedAt: number
}

function storageKey(jobId: string): string {
  return `${STORAGE_PREFIX}${jobId}`
}

export function loadInspectDraft(jobId: string): InspectDraft | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(storageKey(jobId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Persisted
    if (parsed?.v !== INSPECT_DRAFT_VERSION) return null
    if (!parsed.state || typeof parsed.state !== 'object') return null
    return parsed.state
  } catch {
    return null
  }
}

export function saveInspectDraft(jobId: string, state: InspectDraft): void {
  if (typeof window === 'undefined') return
  try {
    const payload: Persisted = {
      v: INSPECT_DRAFT_VERSION,
      state,
      savedAt: Date.now(),
    }
    window.localStorage.setItem(storageKey(jobId), JSON.stringify(payload))
  } catch {
    /* quota / private mode — non-fatal, draft just won't persist */
  }
}

export function clearInspectDraft(jobId: string): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(storageKey(jobId))
  } catch {
    /* non-fatal */
  }
}

/**
 * "Has the clerk done anything worth restoring?" — used by the
 * draft-restored toast so we don't pop the banner when the only state
 * difference is a single tap on the "Add additional room" button.
 */
export function isMeaningfulInspectDraft(state: InspectDraft): boolean {
  if (state.generalNotes.trim().length > 0) return true
  if (state.meters.length > 0) return true
  if (state.smokeAlarmsChecked || state.carbonMonoxideChecked) return true
  return state.rooms.some(
    (r) =>
      r.notes.trim().length > 0 ||
      r.overallCondition !== null ||
      r.photos.length > 0 ||
      r.items.some(
        (i) =>
          i.description.trim().length > 0 ||
          i.condition.trim().length > 0 ||
          i.photos.length > 0
      )
  )
}
