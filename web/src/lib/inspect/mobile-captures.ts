import 'server-only'
import { asc, eq } from 'drizzle-orm'
import {
  db,
  inspectionCaptureItems,
  inspectionCaptures,
  inspectionRoomsMap,
} from '@/db'
import { signStoredAssetUrl } from '@/lib/storage/download'
import {
  ROOM_TYPES,
  type RoomType,
} from '@/lib/inspection/build-rooms'
import { getItemsForRoomType } from '@/lib/inspection/item-templates'
import type {
  PriorItem,
  PriorPhoto,
  PriorRoom,
  PriorSubmission,
} from './prior-submission'

/**
 * Bridge: on-site photos a clerk captured with the Mobile PWA land in
 * `inspection_captures` (private `job-photos` bucket, grouped by an
 * `inspection_rooms_map` room + a free-text item name). This loader
 * pulls those captures and reshapes them into the same
 * `PriorSubmission` structure the desktop `/inspect` form already seeds
 * from — so the captured thumbnails show up under their rooms + item
 * titles, waiting for the clerk to add a description + condition.
 *
 * Behaviour:
 *   - Rooms come from the mobile rooms that actually have captures.
 *   - Each room is given its standard template item checklist; a
 *     capture whose `itemName` matches a template item (case-insensitive)
 *     attaches its photo there, a capture with a non-template name adds a
 *     new item, and a capture with no item name becomes a room-level
 *     photo.
 *   - All `job-photos` URLs are re-signed for an hour so thumbnails
 *     render immediately (the bucket is private).
 *   - Descriptions + conditions come from `inspection_capture_items`
 *     (0039) where the clerk typed them on the phone, and are blank
 *     otherwise. The desktop form is now a review-and-finish surface for
 *     a mobile write-up rather than the only place prose can be entered.
 *
 * Returns null when the job has no mobile captures and no mobile
 * write-up (the normal desktop-only path).
 */
export async function loadMobileCaptures(
  jobId: string
): Promise<PriorSubmission | null> {
  const [rows, writeUps] = await Promise.all([
    db
      .select({
        captureId: inspectionCaptures.id,
        roomId: inspectionCaptures.roomId,
        itemName: inspectionCaptures.itemName,
        photoUrl: inspectionCaptures.photoUrl,
        position: inspectionCaptures.position,
        roomName: inspectionRoomsMap.roomName,
        roomOrder: inspectionRoomsMap.roomOrder,
      })
      .from(inspectionCaptures)
      .innerJoin(
        inspectionRoomsMap,
        eq(inspectionRoomsMap.id, inspectionCaptures.roomId)
      )
      .where(eq(inspectionCaptures.jobId, jobId))
      .orderBy(
        asc(inspectionRoomsMap.roomOrder),
        asc(inspectionCaptures.position)
      ),
    // 0039 — the description + condition the clerk typed on the phone.
    // Includes items with NO photo (walls, ceilings) and rooms the clerk
    // wrote up without shooting anything, which is why this is its own
    // query rather than a join off the captures.
    db
      .select({
        roomId: inspectionCaptureItems.roomId,
        itemName: inspectionCaptureItems.itemName,
        itemOrder: inspectionCaptureItems.itemOrder,
        description: inspectionCaptureItems.description,
        conditionNotes: inspectionCaptureItems.conditionNotes,
        removed: inspectionCaptureItems.removed,
        roomName: inspectionRoomsMap.roomName,
        roomOrder: inspectionRoomsMap.roomOrder,
      })
      .from(inspectionCaptureItems)
      .innerJoin(
        inspectionRoomsMap,
        eq(inspectionRoomsMap.id, inspectionCaptureItems.roomId)
      )
      .where(eq(inspectionCaptureItems.jobId, jobId))
      .orderBy(
        asc(inspectionRoomsMap.roomOrder),
        asc(inspectionCaptureItems.itemOrder)
      ),
  ])

  if (rows.length === 0 && writeUps.length === 0) return null

  // Prose, keyed by room + lowercased item name — the same case-insensitive
  // key the mobile app groups captures under.
  const writeUpByKey = new Map<
    string,
    { description: string; condition: string; order: number }
  >()
  // Template items the clerk explicitly struck off a room ("no dishwasher
  // in this kitchen"). We must not re-seed them from the template below,
  // or every desktop review would resurrect them.
  const removedByRoom = new Map<string, Set<string>>()
  for (const w of writeUps) {
    const key = `${w.roomId}::${w.itemName.trim().toLowerCase()}`
    if (w.removed) {
      const set = removedByRoom.get(w.roomId) ?? new Set<string>()
      set.add(w.itemName.trim().toLowerCase())
      removedByRoom.set(w.roomId, set)
      continue
    }
    writeUpByKey.set(key, {
      description: w.description ?? '',
      condition: w.conditionNotes ?? '',
      order: w.itemOrder,
    })
  }

  // Sign every distinct photo URL once, in parallel.
  const signedByUrl = new Map<string, string>()
  await Promise.all(
    Array.from(new Set(rows.map((r) => r.photoUrl).filter(Boolean))).map(
      async (url) => {
        const signed = (await signStoredAssetUrl(url, 60 * 60)) ?? url
        signedByUrl.set(url, signed)
      }
    )
  )

  const toPhoto = (row: {
    captureId: string
    photoUrl: string
  }): PriorPhoto => ({
    clientId: `capture-${row.captureId}`,
    url: row.photoUrl,
    // The capture URL doubles as a stable identity; submit treats it
    // the same as a desktop-uploaded photo (same inspection_photos row).
    storagePath: row.photoUrl,
    previewUrl: signedByUrl.get(row.photoUrl) ?? row.photoUrl,
  })

  // Group captures by room (preserving roomOrder), then by item name.
  type RoomBucket = {
    roomId: string
    roomName: string
    roomOrder: number
    roomType: RoomType
    /** lowercase itemName → photos */
    itemPhotos: Map<string, { name: string; photos: PriorPhoto[] }>
    roomPhotos: PriorPhoto[]
  }
  const buckets = new Map<string, RoomBucket>()

  const ensureBucket = (
    roomId: string,
    roomName: string,
    roomOrder: number
  ): RoomBucket => {
    let bucket = buckets.get(roomId)
    if (!bucket) {
      bucket = {
        roomId,
        roomName,
        roomOrder,
        roomType: inferRoomType(roomName),
        itemPhotos: new Map(),
        roomPhotos: [],
      }
      buckets.set(roomId, bucket)
    }
    return bucket
  }

  for (const row of rows) {
    const bucket = ensureBucket(row.roomId, row.roomName, row.roomOrder)
    const photo = toPhoto(row)
    const name = (row.itemName ?? '').trim()
    if (!name) {
      bucket.roomPhotos.push(photo)
      continue
    }
    const key = name.toLowerCase()
    const existing = bucket.itemPhotos.get(key)
    if (existing) existing.photos.push(photo)
    else bucket.itemPhotos.set(key, { name, photos: [photo] })
  }

  // A room the clerk wrote up without photographing anything (or an item
  // recorded with prose alone) still has to reach the desktop form.
  for (const w of writeUps) {
    if (w.removed) continue
    const bucket = ensureBucket(w.roomId, w.roomName, w.roomOrder)
    const name = w.itemName.trim()
    if (!name) continue
    const key = name.toLowerCase()
    if (!bucket.itemPhotos.has(key)) {
      bucket.itemPhotos.set(key, { name, photos: [] })
    }
  }

  const rooms: PriorRoom[] = Array.from(buckets.values())
    .sort((a, b) => a.roomOrder - b.roomOrder)
    .map((bucket): PriorRoom => {
      const removed = removedByRoom.get(bucket.roomId) ?? new Set<string>()
      const proseFor = (name: string) =>
        writeUpByKey.get(`${bucket.roomId}::${name.trim().toLowerCase()}`)

      // Start from the template checklist so the clerk has the standard
      // items to review; attach captured photos and whatever prose the
      // mobile app already collected for each.
      const templateNames = getItemsForRoomType(bucket.roomType).filter(
        (n) => !removed.has(n.toLowerCase())
      )
      const usedKeys = new Set<string>()
      const items: PriorItem[] = templateNames.map((tplName): PriorItem => {
        const key = tplName.toLowerCase()
        const captured = bucket.itemPhotos.get(key)
        if (captured) usedKeys.add(key)
        const prose = proseFor(tplName)
        return {
          clientId: `cap-item-${bucket.roomId}-${slug(tplName)}`,
          itemName: tplName,
          description: prose?.description ?? '',
          condition: prose?.condition ?? '',
          photos: captured ? captured.photos : [],
        }
      })

      // Items whose name didn't match a template get appended, ordered by
      // the position the clerk gave them on the phone.
      const extras = Array.from(bucket.itemPhotos.entries())
        .filter(([key]) => !usedKeys.has(key))
        .sort(
          ([a], [b]) =>
            (proseFor(a)?.order ?? Number.MAX_SAFE_INTEGER) -
            (proseFor(b)?.order ?? Number.MAX_SAFE_INTEGER)
        )
      for (const [, captured] of extras) {
        const prose = proseFor(captured.name)
        items.push({
          clientId: `cap-item-${bucket.roomId}-${slug(captured.name)}`,
          itemName: captured.name,
          description: prose?.description ?? '',
          condition: prose?.condition ?? '',
          photos: captured.photos,
        })
      }

      return {
        clientId: `cap-room-${bucket.roomId}`,
        name: bucket.roomName,
        roomType: bucket.roomType,
        overallCondition: null,
        notes: '',
        items,
        photos: bucket.roomPhotos,
      }
    })

  return {
    reportId: `mobile-captures-${jobId}`,
    rooms,
    generalNotes: '',
    meters: [],
    smokeAlarmsChecked: false,
    carbonMonoxideChecked: false,
  }
}

// ── helpers ─────────────────────────────────────────────────────────

/**
 * Best-effort map a mobile room name ("Bedroom 1", "Other / Storage",
 * "Garden / Outdoor") onto a desktop RoomType so the right template
 * checklist applies. Falls back to `other`.
 */
function inferRoomType(roomName: string): RoomType {
  const n = roomName.toLowerCase()
  // Order matters — check more specific tokens first.
  const rules: Array<[RegExp, RoomType]> = [
    [/\bensuite|en-suite\b/, 'bathroom'],
    [/\b(master )?bath|shower\b/, 'bathroom'],
    [/\b(wc|toilet|cloak)\b/, 'toilet'],
    [/\bkitchen\b/, 'kitchen'],
    [/\b(living|lounge|sitting|reception)\b/, 'living_room'],
    [/\bdining\b/, 'dining_room'],
    [/\bbed\s?room|\bbedroom\b/, 'bedroom'],
    [/\b(hall|landing|stair|entrance|porch)\b/, 'hallway'],
    [/\b(utility|laundry)\b/, 'utility'],
    [/\b(garage)\b/, 'garage'],
    [/\b(balcony|terrace)\b/, 'balcony'],
    [/\b(garden|outdoor|patio|yard)\b/, 'garden'],
    [/\b(storage|store|cupboard|loft|attic)\b/, 'storage'],
  ]
  for (const [re, type] of rules) {
    if (re.test(n)) return type
  }
  // A bare "bedroom N" without word boundary already caught above; final
  // guard ensures the returned value is a real RoomType.
  return (ROOM_TYPES as readonly string[]).includes('other')
    ? 'other'
    : 'other'
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
}
