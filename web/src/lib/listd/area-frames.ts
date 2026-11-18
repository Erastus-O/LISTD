/**
 * Photo frames for evidence: cleaning photographs every area of the property,
 * repairs photograph the area worked on. The Pro removes frames that don't
 * apply and adds any that are missing; each remaining frame needs a photo.
 * Inspections keep their own room-by-room report. Pure.
 */

export type AreaPhotos = { area: string; paths: string[] }

const n = (v: number | null | undefined, d: number) => Math.max(0, Math.min(12, Number.isFinite(Number(v)) && v != null ? Number(v) : d))
const numbered = (label: string, count: number) => (count <= 1 ? (count === 1 ? [label] : []) : Array.from({ length: count }, (_, i) => `${label} ${i + 1}`))

export function cleaningAreas(p: { bedrooms?: number | null; bathrooms?: number | null; kitchens?: number | null; livingRooms?: number | null } | null): string[] {
  return [
    'Entrance and hallway',
    ...numbered('Kitchen', n(p?.kitchens, 1)),
    ...numbered('Living room', n(p?.livingRooms, 1)),
    ...numbered('Bedroom', n(p?.bedrooms, 1)),
    ...numbered('Bathroom', n(p?.bathrooms, 1)),
  ]
}

export function repairAreas(scope: { location?: string | null; category?: string | null } | null): string[] {
  const where = scope?.location?.trim()
  return [where ? `Repair area: ${where}` : 'Repair area', 'Finished repair']
}

/** Every frame has at least one photo. */
export function framesComplete(frames: AreaPhotos[]): boolean {
  return frames.length > 0 && frames.every((f) => f.paths.length > 0)
}
