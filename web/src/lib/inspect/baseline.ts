import 'server-only'
import { and, asc, desc, eq, inArray, lt, ne, or } from 'drizzle-orm'
import {
  db,
  inspectionItems,
  inspectionPhotos,
  inspectionReports,
  inspectionRooms,
  jobs,
} from '@/db'
import { signStoredAssetUrl } from '@/lib/storage/download'
import {
  baselineKey,
  type BaselineData,
  type BaselinePhoto,
} from './baseline-key'

/**
 * Before/after baseline. For the current inspection of a property, the
 * **"before"** photos come from that property's **most recent prior completed
 * inspection** (any type) — so a check-out compares to the last inspection
 * before it, a re-let new-inventory compares to the prior check-out, etc.
 *
 * Photos are matched to the current inspection **by room + item name** (ids
 * differ per job). All `job-photos` URLs are re-signed for an hour so the
 * thumbnails render from the private bucket.
 */

export type { BaselineData, BaselinePhoto }
export { baselineKey }

const COMPLETED_STATUSES = [
  'submitted',
  'reviewed',
  'signed',
  'completed',
  'paid',
] as const

export async function loadBaselineForJob(
  currentJobId: string
): Promise<BaselineData | null> {
  // 1. Current job's property + date (the comparison anchor).
  const [cur] = await db
    .select({
      propertyId: jobs.propertyId,
      scheduledDate: jobs.scheduledDate,
      createdAt: jobs.createdAt,
    })
    .from(jobs)
    .where(eq(jobs.id, currentJobId))
    .limit(1)
  if (!cur) return null

  // 2. Most recent PRIOR completed inspection of the same property that has a
  //    structured report. "Prior" = earlier scheduled date (createdAt breaks
  //    same-day ties).
  const [prior] = await db
    .select({
      jobId: jobs.id,
      inspectionType: jobs.inspectionType,
      scheduledDate: jobs.scheduledDate,
      reportId: inspectionReports.id,
    })
    .from(jobs)
    .innerJoin(inspectionReports, eq(inspectionReports.jobId, jobs.id))
    .where(
      and(
        eq(jobs.propertyId, cur.propertyId),
        ne(jobs.id, currentJobId),
        inArray(jobs.status, [...COMPLETED_STATUSES]),
        or(
          lt(jobs.scheduledDate, cur.scheduledDate),
          and(
            eq(jobs.scheduledDate, cur.scheduledDate),
            lt(jobs.createdAt, cur.createdAt)
          )
        )
      )
    )
    .orderBy(desc(jobs.scheduledDate), desc(jobs.createdAt))
    .limit(1)
  if (!prior) return null

  // 3. Load that report's rooms / items / photos.
  const roomRows = await db
    .select({ id: inspectionRooms.id, roomName: inspectionRooms.roomName })
    .from(inspectionRooms)
    .where(eq(inspectionRooms.reportId, prior.reportId))
  const roomIds = roomRows.map((r) => r.id)
  const itemRows = roomIds.length
    ? await db
        .select({
          id: inspectionItems.id,
          roomId: inspectionItems.roomId,
          itemName: inspectionItems.itemName,
        })
        .from(inspectionItems)
        .where(inArray(inspectionItems.roomId, roomIds))
        .orderBy(asc(inspectionItems.itemOrder))
    : []
  const photoRows = await db
    .select({
      roomId: inspectionPhotos.roomId,
      itemId: inspectionPhotos.itemId,
      photoUrl: inspectionPhotos.photoUrl,
    })
    .from(inspectionPhotos)
    .where(eq(inspectionPhotos.reportId, prior.reportId))
  if (photoRows.length === 0) return null

  // Sign every distinct URL once (private bucket → thumbnails need signing).
  const signedByUrl = new Map<string, string>()
  await Promise.all(
    Array.from(new Set(photoRows.map((p) => p.photoUrl).filter(Boolean))).map(
      async (raw) => {
        const url = raw as string
        signedByUrl.set(url, (await signStoredAssetUrl(url, 60 * 60)) ?? url)
      }
    )
  )

  const roomNameById = new Map(roomRows.map((r) => [r.id, r.roomName]))
  const itemNameById = new Map(itemRows.map((i) => [i.id, i.itemName]))

  const byRoomItem: Record<string, BaselinePhoto[]> = {}
  for (const p of photoRows) {
    const roomName = p.roomId ? roomNameById.get(p.roomId) ?? '' : ''
    if (!roomName) continue
    const itemName = p.itemId ? itemNameById.get(p.itemId) ?? null : null
    const key = baselineKey(roomName, itemName)
    const photo: BaselinePhoto = {
      url: p.photoUrl,
      previewUrl: signedByUrl.get(p.photoUrl) ?? p.photoUrl,
    }
    ;(byRoomItem[key] ??= []).push(photo)
  }

  return {
    priorJobId: prior.jobId,
    priorInspectionType: prior.inspectionType,
    priorDate: prior.scheduledDate,
    byRoomItem,
  }
}
