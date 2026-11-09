import 'server-only'
import { and, desc, eq, inArray } from 'drizzle-orm'
import {
  db,
  inspectionItems,
  inspectionPhotos,
  inspectionReports,
  inspectionRooms,
  reports,
} from '@/db'
import { signStoredAssetUrl } from '@/lib/storage/download'
import {
  type DerivedRoom,
  type RoomType,
} from '@/lib/inspection/build-rooms'

/**
 * When an admin returns a report for amends the job flips back to
 * `in_progress` and the clerk is sent to `/inspect` to edit. That page
 * used to re-derive a blank form from the property's room layout — so
 * the clerk had to type their entire previous submission again.
 *
 * This loader pulls the most recent `returned` report and hydrates it
 * into the shape the form's `priorSubmission` prop expects: rooms with
 * items (+ description / condition / photos) and the property-wide
 * fields (meters, alarms, general notes). Photo URLs are re-signed
 * here for an hour so thumbnails show up immediately.
 */

export type PriorPhoto = {
  clientId: string
  url: string
  storagePath: string
  previewUrl: string
}

export type PriorItem = {
  clientId: string
  itemName: string
  description: string
  condition: string
  photos: PriorPhoto[]
}

export type PriorRoom = {
  clientId: string
  name: string
  roomType: RoomType
  overallCondition: string | null
  notes: string
  items: PriorItem[]
  photos: PriorPhoto[]
}

export type PriorMeter = {
  id: string
  label: string
  serialNumber: string
  value: string
  location: string
  supplier: string
}

export type PriorSubmission = {
  reportId: string
  rooms: PriorRoom[]
  generalNotes: string
  meters: PriorMeter[]
  smokeAlarmsChecked: boolean
  carbonMonoxideChecked: boolean
}

/**
 * Resolve the most recent `returned` report for a job and hydrate the
 * full submission. Returns null when nothing's been returned (the
 * normal first-time-inspecting path).
 */
export async function loadPriorReturnedSubmission(
  jobId: string
): Promise<PriorSubmission | null> {
  // `reports` is the QA-facing PDF-status table; the rich
  // `inspection_reports` row (rooms/items/photos/meters) lives in
  // parallel. Detection works in two hops: status='returned' in
  // `reports` → load the most recent `inspection_reports` for the
  // same jobId.
  const [returned] = await db
    .select({ id: reports.id })
    .from(reports)
    .where(and(eq(reports.jobId, jobId), eq(reports.status, 'returned')))
    .limit(1)
  if (!returned) return null

  const [report] = await db
    .select({
      id: inspectionReports.id,
      generalNotes: inspectionReports.generalNotes,
      smokeAlarmsChecked: inspectionReports.smokeAlarmsChecked,
      carbonMonoxideChecked: inspectionReports.carbonMonoxideChecked,
      meterReadings: inspectionReports.meterReadings,
    })
    .from(inspectionReports)
    .where(eq(inspectionReports.jobId, jobId))
    .orderBy(desc(inspectionReports.createdAt))
    .limit(1)
  if (!report) return null

  const roomRows = await db
    .select({
      id: inspectionRooms.id,
      roomName: inspectionRooms.roomName,
      roomType: inspectionRooms.roomType,
      overallCondition: inspectionRooms.overallCondition,
      notes: inspectionRooms.notes,
    })
    .from(inspectionRooms)
    .where(eq(inspectionRooms.reportId, report.id))

  const roomIds = roomRows.map((r) => r.id)
  const itemRows = roomIds.length
    ? await db
        .select({
          id: inspectionItems.id,
          roomId: inspectionItems.roomId,
          itemName: inspectionItems.itemName,
          description: inspectionItems.description,
          condition: inspectionItems.condition,
          conditionNotes: inspectionItems.conditionNotes,
          cleanliness: inspectionItems.cleanliness,
        })
        .from(inspectionItems)
        .where(inArray(inspectionItems.roomId, roomIds))
    : []

  const photoRows = await db
    .select({
      id: inspectionPhotos.id,
      roomId: inspectionPhotos.roomId,
      itemId: inspectionPhotos.itemId,
      photoUrl: inspectionPhotos.photoUrl,
    })
    .from(inspectionPhotos)
    .where(eq(inspectionPhotos.reportId, report.id))

  // Sign every photo URL in parallel. The bucket is private; the
  // form needs signed URLs to actually render thumbnails. One-hour TTL
  // — comfortable headroom for a long amendment session.
  const signedByUrl = new Map<string, string>()
  await Promise.all(
    Array.from(new Set(photoRows.map((p) => p.photoUrl).filter(Boolean))).map(
      async (rawUrl) => {
        const url = rawUrl as string
        const signed = (await signStoredAssetUrl(url, 60 * 60)) ?? url
        signedByUrl.set(url, signed)
      }
    )
  )

  const toPhoto = (p: { id: string; photoUrl: string | null }): PriorPhoto => {
    const url = p.photoUrl ?? ''
    return {
      clientId: p.id,
      url,
      // The clerk PhotoUploader stores the path; here we just keep the
      // url itself as a stable identifier — re-uploads aren't needed.
      storagePath: url,
      previewUrl: signedByUrl.get(url) ?? url,
    }
  }

  const rooms: PriorRoom[] = roomRows.map((room) => {
    const roomItems = itemRows
      .filter((it) => it.roomId === room.id)
      .map((it): PriorItem => {
        const itemPhotos = photoRows
          .filter((p) => p.itemId === it.id)
          .map(toPhoto)
        // Hydrate the new free-text fields. Legacy rows that wrote the
        // enum into `condition` and the cleanliness label get a
        // human-readable fallback so the clerk sees something
        // meaningful in each slot.
        return {
          clientId: it.id,
          itemName: it.itemName,
          description: it.description ?? it.cleanliness ?? '',
          condition:
            it.conditionNotes ??
            (it.condition ? prettyEnum(it.condition) : ''),
          photos: itemPhotos,
        }
      })
    const roomPhotos = photoRows
      .filter((p) => p.roomId === room.id && !p.itemId)
      .map(toPhoto)
    return {
      clientId: room.id,
      name: room.roomName,
      roomType: room.roomType as RoomType,
      overallCondition: room.overallCondition ?? null,
      notes: room.notes ?? '',
      items: roomItems,
      photos: roomPhotos,
    }
  })

  // meter_readings is a jsonb column shaped to the new
  // { label, value, serialNumber?, location?, supplier? } record.
  const meters: PriorMeter[] = Array.isArray(report.meterReadings)
    ? (
        report.meterReadings as Array<{
          label?: unknown
          value?: unknown
          serialNumber?: unknown
          location?: unknown
          supplier?: unknown
        }>
      ).map((m, idx) => ({
        id: `prior-meter-${idx}`,
        label: String(m?.label ?? ''),
        serialNumber: typeof m?.serialNumber === 'string' ? m.serialNumber : '',
        value: String(m?.value ?? ''),
        location: typeof m?.location === 'string' ? m.location : '',
        supplier: typeof m?.supplier === 'string' ? m.supplier : '',
      }))
    : []

  return {
    reportId: report.id,
    rooms,
    generalNotes: report.generalNotes ?? '',
    meters,
    smokeAlarmsChecked: Boolean(report.smokeAlarmsChecked),
    carbonMonoxideChecked: Boolean(report.carbonMonoxideChecked),
  }
}

/** Equivalent to the helper in render-official.ts — render a legacy
 *  condition enum value as readable prose so old rows display something
 *  meaningful in the new free-text condition slot. */
function prettyEnum(value: string): string {
  if (value === 'na') return 'Not applicable'
  return value.charAt(0).toUpperCase() + value.slice(1)
}

/**
 * Convert a `PriorSubmission` into the `DerivedRoom[]` shape the form
 * uses when no prior submission exists. Mostly trivial — the form just
 * cares about clientId / name / roomType / order. Items get added back
 * inside the form from the same submission via the richer hydrate path.
 */
export function priorRoomsAsDerived(prior: PriorSubmission): DerivedRoom[] {
  return prior.rooms.map((r, idx) => ({
    clientId: r.clientId,
    name: r.name,
    roomType: r.roomType,
    order: idx,
  }))
}
