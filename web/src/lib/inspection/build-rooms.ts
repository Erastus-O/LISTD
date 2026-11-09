/**
 * Derive the inspection room list from a property's room counts.
 *
 * The clerk submit-report flow used to ship a string-only room list — fine
 * for ticking a checklist, but not enough to populate the structured
 * inspection wizard, which needs the `room_type` enum to look up the right
 * item template (kitchens get hobs, bedrooms get wardrobes, etc.).
 *
 * Each numeric count on `properties` maps to one or more enum-typed rooms,
 * with a stable display name and an explicit ordering for the PDF layout.
 */

export const ROOM_TYPES = [
  'entrance',
  'hallway',
  'living_room',
  'dining_room',
  'kitchen',
  'bedroom',
  'bathroom',
  'toilet',
  'utility',
  'storage',
  'garden',
  'garage',
  'balcony',
  'other',
] as const

export type RoomType = (typeof ROOM_TYPES)[number]

export type DerivedRoom = {
  /** Stable client-side id used while editing — server reassigns UUIDs on save. */
  clientId: string
  name: string
  roomType: RoomType
  /** Render order in the PDF + form. */
  order: number
}

export type RoomCounts = {
  hallwaysStairs: number
  livingRooms: number
  diningAreas: number
  kitchens: number
  bedrooms: number
  bathrooms: number
  utilityRooms: number
  storageRooms: number
  gardens: number
}

/** Display label per room_type, used in the PDF + form headings. */
export const ROOM_TYPE_LABELS: Record<RoomType, string> = {
  entrance: 'Entrance',
  hallway: 'Hallway',
  living_room: 'Living Room',
  dining_room: 'Dining Area',
  kitchen: 'Kitchen',
  bedroom: 'Bedroom',
  bathroom: 'Bathroom',
  toilet: 'WC / Toilet',
  utility: 'Utility',
  storage: 'Storage',
  garden: 'Garden',
  garage: 'Garage',
  balcony: 'Balcony',
  other: 'Other',
}

const COUNT_TO_TYPE: Array<{ key: keyof RoomCounts; type: RoomType }> = [
  { key: 'hallwaysStairs', type: 'hallway' },
  { key: 'livingRooms', type: 'living_room' },
  { key: 'diningAreas', type: 'dining_room' },
  { key: 'kitchens', type: 'kitchen' },
  { key: 'bedrooms', type: 'bedroom' },
  { key: 'bathrooms', type: 'bathroom' },
  { key: 'utilityRooms', type: 'utility' },
  { key: 'storageRooms', type: 'storage' },
  { key: 'gardens', type: 'garden' },
]

/**
 * Walks the property's room counts in PDF order and emits one `DerivedRoom`
 * per unit. If the property has no recorded rooms (older draft, missing
 * data), returns a single `other` row so the clerk still has a surface to
 * record general notes.
 */
export function deriveRooms(p: RoomCounts): DerivedRoom[] {
  const out: DerivedRoom[] = []
  let order = 0
  for (const { key, type } of COUNT_TO_TYPE) {
    const count = Math.max(0, p[key] ?? 0)
    for (let i = 1; i <= count; i++) {
      const label = ROOM_TYPE_LABELS[type]
      const name = count > 1 ? `${label} ${i}` : label
      out.push({
        clientId: `${type}-${i}`,
        name,
        roomType: type,
        order: order++,
      })
    }
  }
  if (out.length === 0) {
    out.push({
      clientId: 'other-1',
      name: 'Main Property',
      roomType: 'other',
      order: 0,
    })
  }
  return out
}
