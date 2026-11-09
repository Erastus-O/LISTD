/**
 * Predefined inventory items per room type for the clerk inspection wizard.
 *
 * The clerk loads a job's inspection page; we derive the room list from the
 * property (e.g. "2 bedrooms, 1 kitchen") and each room is pre-populated
 * with this item template. The clerk ticks condition + cleanliness and
 * leaves notes — no typing the same furniture list every time.
 *
 * Lovable shipped a similar list inside `RoomDetailDrawer.tsx`; ports here
 * with edits informed by what UK property inventory clerks actually inspect
 * (BS 7858 background, AIIC inventory standard categories).
 *
 * Templates are *defaults*. The form lets the clerk add/remove items per
 * room — a furnished kitchen has a microwave, an unfurnished one doesn't.
 */
import type { RoomType } from './build-rooms'

const COMMON_ROOM_BASICS = [
  'Walls',
  'Ceiling',
  'Flooring',
  'Skirting boards',
  'Windows',
  'Window coverings',
  'Light fittings',
  'Sockets & switches',
  'Doors & handles',
]

const ITEM_TEMPLATES: Record<RoomType, string[]> = {
  entrance: [
    ...COMMON_ROOM_BASICS,
    'Door entry / intercom',
    'Front door & frame',
    'Mat / matwell',
  ],
  hallway: [
    ...COMMON_ROOM_BASICS,
    'Stair carpet / treads',
    'Banister & balustrade',
    'Smoke alarm',
  ],
  living_room: [
    ...COMMON_ROOM_BASICS,
    'Sofa',
    'Armchair(s)',
    'Coffee table',
    'TV unit',
    'TV aerial / ariel point',
    'Curtains / blinds',
    'Radiator',
  ],
  dining_room: [
    ...COMMON_ROOM_BASICS,
    'Dining table',
    'Dining chairs',
    'Sideboard / dresser',
    'Radiator',
  ],
  kitchen: [
    ...COMMON_ROOM_BASICS,
    'Oven',
    'Hob',
    'Extractor fan / hood',
    'Fridge / freezer',
    'Washing machine',
    'Dishwasher',
    'Microwave',
    'Sink & taps',
    'Worktops',
    'Splashback / tiles',
    'Cupboards & drawers',
    'Boiler / combi unit',
  ],
  bedroom: [
    ...COMMON_ROOM_BASICS,
    'Bed frame',
    'Mattress',
    'Wardrobe',
    'Chest of drawers',
    'Bedside table(s)',
    'Curtains / blinds',
    'Radiator',
  ],
  bathroom: [
    ...COMMON_ROOM_BASICS,
    'Bath',
    'Shower / shower screen',
    'Toilet & cistern',
    'Sink & taps',
    'Tiles / grout',
    'Mirror / cabinet',
    'Towel rail / radiator',
    'Extractor fan',
    'Sealant',
  ],
  toilet: [
    ...COMMON_ROOM_BASICS,
    'Toilet & cistern',
    'Sink & taps',
    'Tiles / grout',
    'Extractor fan',
  ],
  utility: [
    ...COMMON_ROOM_BASICS,
    'Washing machine',
    'Tumble dryer',
    'Sink & taps',
    'Worktops',
    'Cupboards',
    'Boiler / hot water cylinder',
  ],
  storage: ['Walls', 'Ceiling', 'Flooring', 'Doors', 'Shelving', 'Light fittings'],
  garden: [
    'Lawn',
    'Patio / decking',
    'Boundary fencing',
    'Gates',
    'Outbuildings / shed',
    'External lighting',
    'Bins & bin store',
  ],
  garage: [
    'Walls',
    'Ceiling',
    'Flooring',
    'Up-and-over / roller door',
    'Side door',
    'Light fittings',
    'Sockets & switches',
  ],
  balcony: [
    'Decking / surface',
    'Balustrade / railing',
    'External lighting',
    'Drainage',
  ],
  other: COMMON_ROOM_BASICS,
}

/**
 * Items the wizard pre-populates for a fresh room of `type`. The clerk can
 * add or remove items per-room before recording conditions.
 */
export function getItemsForRoomType(type: RoomType): string[] {
  return [...ITEM_TEMPLATES[type]]
}
