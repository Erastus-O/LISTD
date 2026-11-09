/**
 * Shared (client-safe) types + key helper for the before/after baseline.
 * Kept separate from `baseline.ts` (which is `server-only`) so the client
 * write-up components can compute the same lookup key.
 */

export type BaselinePhoto = { url: string; previewUrl: string }

export type BaselineData = {
  priorJobId: string
  priorInspectionType: string
  priorDate: string
  /** `${room}||${item}` (or `${room}||` for room-level) → before photos. */
  byRoomItem: Record<string, BaselinePhoto[]>
}

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase()

/** Stable lookup key shared by the loader and the consumers (room+item). */
export function baselineKey(
  roomName: string,
  itemName: string | null
): string {
  return `${norm(roomName)}||${norm(itemName)}`
}
