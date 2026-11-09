import 'server-only'
import { asc, eq, inArray } from 'drizzle-orm'
import {
  inspectionItemPhotos,
  inspectionItemsMap,
  inspectionRoomsMap,
  withServiceRole,
} from '@/db'

/**
 * Server-only data layer for the tenant portal report viewer (M3 #5–7 / S3
 * of the Lovable port roadmap). Replaces the legacy `tenant_report_detail`
 * Supabase RPC.
 *
 * Caller has already validated the inbound token via `resolveTenantToken`
 * — this lib trusts the resolved jobId and queries within that scope only.
 */

export type TenantReportPhoto = {
  id: string
  photoUrl: string
}

export type TenantReportItem = {
  id: string
  itemName: string
  condition: string | null
  notes: string | null
  photos: TenantReportPhoto[]
}

export type TenantReportRoom = {
  id: string
  roomName: string
  roomOrder: number
  items: TenantReportItem[]
}

/**
 * Load the rooms / items / photos hierarchy for a job, ordered the same way
 * the Lovable RPC did (rooms by `room_order`, items by insertion order).
 *
 * Three queries inside one transaction; assembled in app code rather than
 * trying to do nested `json_agg` (which Drizzle would let us do but adds
 * type-safety friction without much win).
 */
export async function loadTenantReportDetail(
  jobId: string
): Promise<TenantReportRoom[]> {
  return withServiceRole(async (tx) => {
    const rooms = await tx
      .select({
        id: inspectionRoomsMap.id,
        roomName: inspectionRoomsMap.roomName,
        roomOrder: inspectionRoomsMap.roomOrder,
      })
      .from(inspectionRoomsMap)
      .where(eq(inspectionRoomsMap.jobId, jobId))
      .orderBy(asc(inspectionRoomsMap.roomOrder))

    if (rooms.length === 0) return []

    const roomIds = rooms.map((r) => r.id)
    const items = await tx
      .select({
        id: inspectionItemsMap.id,
        roomId: inspectionItemsMap.roomId,
        itemName: inspectionItemsMap.itemName,
        condition: inspectionItemsMap.condition,
        notes: inspectionItemsMap.notes,
      })
      .from(inspectionItemsMap)
      .where(inArray(inspectionItemsMap.roomId, roomIds))
      .orderBy(asc(inspectionItemsMap.createdAt))

    const itemIds = items.map((i) => i.id)
    const photos =
      itemIds.length === 0
        ? []
        : await tx
            .select({
              id: inspectionItemPhotos.id,
              itemId: inspectionItemPhotos.itemId,
              photoUrl: inspectionItemPhotos.photoUrl,
            })
            .from(inspectionItemPhotos)
            .where(inArray(inspectionItemPhotos.itemId, itemIds))
            .orderBy(asc(inspectionItemPhotos.createdAt))

    const photosByItem = new Map<string, TenantReportPhoto[]>()
    for (const p of photos) {
      const list = photosByItem.get(p.itemId) ?? []
      list.push({ id: p.id, photoUrl: p.photoUrl })
      photosByItem.set(p.itemId, list)
    }

    const itemsByRoom = new Map<string, TenantReportItem[]>()
    for (const i of items) {
      const list = itemsByRoom.get(i.roomId) ?? []
      list.push({
        id: i.id,
        itemName: i.itemName,
        condition: i.condition,
        notes: i.notes,
        photos: photosByItem.get(i.id) ?? [],
      })
      itemsByRoom.set(i.roomId, list)
    }

    return rooms.map((r) => ({
      id: r.id,
      roomName: r.roomName,
      roomOrder: r.roomOrder,
      items: itemsByRoom.get(r.id) ?? [],
    }))
  })
}
