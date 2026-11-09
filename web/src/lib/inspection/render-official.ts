import 'server-only'
import { asc, desc, eq, inArray } from 'drizzle-orm'
import {
  db,
  inspectionItems,
  inspectionPhotos,
  inspectionReports,
  inspectionRooms,
  jobs,
  profiles,
  properties,
} from '@/db'
import { INSPECTION_TYPE_LABELS, type InspectionType } from '@/lib/pricing-matrix'
import { contentTypeFromUrl, downloadStorageBytes } from '@/lib/storage/download'
import { loadBaselineForJob, baselineKey } from '@/lib/inspect/baseline'
import {
  renderInspectionPdf,
  type ConditionRating,
  type InspectionPdfInputs,
  type InspectionRoomInput,
  type PhotoBytes,
} from './render-pdf'
import type { RoomType } from './build-rooms'
import type { ExecutiveSummary } from '@/lib/ai/executive-summary'

/**
 * Re-render the **clean, official** inspection report for a job from the
 * persisted structured data (inspection_reports / _rooms / _items / _photos).
 *
 * Used by the quality-review approval flow: the clerk submit stores a
 * watermarked "provisional" copy; on approval we regenerate the watermark-free
 * official version from the same data the provisional was built from. Photos
 * are re-downloaded via the storage admin client.
 *
 * Returns `null` when the job has no persisted inspection report (e.g. a
 * legacy upload-a-PDF report that predates the structured flow) — the caller
 * should then leave the existing PDF in place.
 */
export async function renderOfficialReportForJob(
  jobId: string
): Promise<Uint8Array | null> {
  const built = await loadRenderInputs(jobId)
  if (!built) return null
  const photoBytes = await fetchPhotoBytesMap(built.photoUrls)
  // Cover thumbnail. Fetched separately from the inspection photos: it's
  // the client's photo of the property (private `property-photos`
  // bucket), not something the clerk shot, and a missing one must never
  // fail the render — the cover just closes up without it.
  const propertyPhoto = built.propertyImageUrl
    ? await fetchPhotoBytes(built.propertyImageUrl)
    : null
  // The clerk's adopted mark (0040). This is the PDF that actually
  // reaches the client, so dropping the signature here would mean a
  // clerk signs on submit and the official copy shows typed text.
  const clerkSignature = built.clerkSignatureUrl
    ? await fetchPhotoBytes(built.clerkSignatureUrl)
    : null
  return renderInspectionPdf({
    ...built.inputs,
    photoBytes,
    propertyPhoto,
    clerkSignature,
  })
}

async function loadRenderInputs(
  jobId: string
): Promise<{
  inputs: Omit<
    InspectionPdfInputs,
    'photoBytes' | 'propertyPhoto' | 'clerkSignature'
  >
  photoUrls: string[]
  propertyImageUrl: string | null
  clerkSignatureUrl: string | null
} | null> {
  const [job] = await db
    .select({
      id: jobs.id,
      clerkId: jobs.clerkId,
      clientId: jobs.clientId,
      inspectionType: jobs.inspectionType,
      addressLine1: properties.addressLine1,
      city: properties.city,
      postcode: properties.postcode,
      propertyImageUrl: properties.imageUrl,
    })
    .from(jobs)
    .leftJoin(properties, eq(properties.id, jobs.propertyId))
    .where(eq(jobs.id, jobId))
    .limit(1)
  if (!job) return null

  // Latest inspection report for the job (most recent submission wins).
  const [rep] = await db
    .select({
      id: inspectionReports.id,
      startedAt: inspectionReports.startedAt,
      completedAt: inspectionReports.completedAt,
      submittedAt: inspectionReports.submittedAt,
      generalNotes: inspectionReports.generalNotes,
      meterReadings: inspectionReports.meterReadings,
      smokeAlarmsChecked: inspectionReports.smokeAlarmsChecked,
      carbonMonoxideChecked: inspectionReports.carbonMonoxideChecked,
      clerkSignatureUrl: inspectionReports.clerkSignatureUrl,
      executiveSummary: inspectionReports.executiveSummary,
    })
    .from(inspectionReports)
    .where(eq(inspectionReports.jobId, jobId))
    .orderBy(desc(inspectionReports.submittedAt), desc(inspectionReports.createdAt))
    .limit(1)
  if (!rep) return null

  const ids = [job.clerkId, job.clientId].filter((v): v is string => Boolean(v))
  const profileRows = ids.length
    ? await db
        .select({
          userId: profiles.userId,
          fullName: profiles.fullName,
          companyName: profiles.companyName,
        })
        .from(profiles)
        .where(inArray(profiles.userId, ids))
    : []
  const clerk = profileRows.find((p) => p.userId === job.clerkId)
  const client = profileRows.find((p) => p.userId === job.clientId)

  const roomRows = await db
    .select({
      id: inspectionRooms.id,
      roomType: inspectionRooms.roomType,
      roomName: inspectionRooms.roomName,
      overallCondition: inspectionRooms.overallCondition,
      notes: inspectionRooms.notes,
    })
    .from(inspectionRooms)
    .where(eq(inspectionRooms.reportId, rep.id))
    .orderBy(asc(inspectionRooms.roomOrder))

  const roomIds = roomRows.map((r) => r.id)
  const itemRows = roomIds.length
    ? await db
        .select({
          id: inspectionItems.id,
          roomId: inspectionItems.roomId,
          itemName: inspectionItems.itemName,
          description: inspectionItems.description,
          condition: inspectionItems.condition,
          cleanliness: inspectionItems.cleanliness,
          conditionNotes: inspectionItems.conditionNotes,
          actionType: inspectionItems.actionType,
          actionComment: inspectionItems.actionComment,
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
      takenAt: inspectionPhotos.takenAt,
    })
    .from(inspectionPhotos)
    .where(eq(inspectionPhotos.reportId, rep.id))

  // Before/after: the property's most recent prior inspection supplies the
  // "before" photos, matched to each item by room+item name. We use the RAW
  // URLs (baseline `.url`, not the signed preview) so the bytes can be fetched.
  const baseline = await loadBaselineForJob(jobId)

  const beforeUrls: string[] = []
  const rooms: InspectionRoomInput[] = roomRows.map((room) => ({
    name: room.roomName,
    roomType: room.roomType as RoomType,
    overallCondition: (room.overallCondition as ConditionRating | null) ?? null,
    notes: room.notes ?? null,
    photoUrls: photoRows
      .filter((p) => p.roomId === room.id && !p.itemId && p.photoUrl)
      .map((p) => p.photoUrl as string),
    items: itemRows
      .filter((it) => it.roomId === room.id)
      .map((it) => {
        const before =
          baseline?.byRoomItem[baselineKey(room.roomName, it.itemName)]?.map(
            (p) => p.url
          ) ?? []
        beforeUrls.push(...before)
        return {
          itemName: it.itemName,
          // The form captures free-text description + condition; map the
          // DB columns straight across. For legacy rows (where the form
          // wrote the enum into `condition` and the cleanliness label,
          // both unused on new captures), fall back so the report still
          // renders something meaningful in each slot.
          description: it.description ?? it.cleanliness ?? null,
          condition:
            it.conditionNotes ??
            (it.condition ? prettyEnum(it.condition) : null),
          actionType:
            it.actionType === 'maintenance' || it.actionType === 'cleaning'
              ? it.actionType
              : null,
          actionComment: it.actionComment ?? null,
          photoUrls: photoRows
            .filter((p) => p.itemId === it.id && p.photoUrl)
            .map((p) => p.photoUrl as string),
          beforePhotoUrls: before,
        }
      }),
  }))

  // Fetch bytes for both this report's photos and the matched before photos.
  const photoUrls = Array.from(
    new Set(
      [...photoRows.map((p) => p.photoUrl), ...beforeUrls].filter(
        (u): u is string => Boolean(u)
      )
    )
  )

  // The `meter_readings` jsonb column predates the richer fields, so we
  // hydrate defensively — string-cast the keys we expect, leave the rest
  // null. Legacy rows with only `label` + `value` still render fine.
  const meterReadings = Array.isArray(rep.meterReadings)
    ? (
        rep.meterReadings as Array<{
          label?: unknown
          value?: unknown
          serialNumber?: unknown
          location?: unknown
          supplier?: unknown
        }>
      ).map((m) => ({
        label: String(m?.label ?? ''),
        value: String(m?.value ?? ''),
        serialNumber: typeof m?.serialNumber === 'string' ? m.serialNumber : null,
        location: typeof m?.location === 'string' ? m.location : null,
        supplier: typeof m?.supplier === 'string' ? m.supplier : null,
      }))
    : []

  const propertyAddress =
    [job.addressLine1, job.city, job.postcode].filter(Boolean).join(', ') ||
    'this property'

  const clerkName = clerk?.fullName ?? 'Inspecting clerk'
  const completedAt = rep.completedAt ?? rep.submittedAt ?? new Date().toISOString()

  return {
    photoUrls,
    propertyImageUrl: job.propertyImageUrl ?? null,
    clerkSignatureUrl: rep.clerkSignatureUrl ?? null,
    inputs: {
      reportLabel: `Job ${jobId.slice(0, 8)}`,
      inspectionTypeLabel:
        INSPECTION_TYPE_LABELS[job.inspectionType as InspectionType] ??
        job.inspectionType,
      propertyAddress,
      clerkName,
      clientName: client?.companyName ?? client?.fullName ?? 'Client',
      inspectionStartedAt: new Date(rep.startedAt ?? completedAt),
      inspectionCompletedAt: new Date(completedAt),
      generalNotes: rep.generalNotes ?? null,
      meterReadings,
      smokeAlarmsChecked: Boolean(rep.smokeAlarmsChecked),
      carbonMonoxideChecked: Boolean(rep.carbonMonoxideChecked),
      executiveSummary: parseExecutiveSummary(rep.executiveSummary),
      rooms,
      photoTakenAt: new Map(
        photoRows
          .filter((photo) => Boolean(photo.photoUrl))
          .map((photo) => [
            photo.photoUrl as string,
            photo.takenAt ? new Date(photo.takenAt) : null,
          ])
      ),
      // The clerk's typed signature isn't persisted on the inspection report;
      // fall back to their profile name (functionally the same on re-render).
      clerkTypedName: clerkName,
    },
  }
}

function parseExecutiveSummary(value: unknown): ExecutiveSummary | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const candidate = value as Record<string, unknown>
  const toStrings = (entries: unknown): string[] =>
    Array.isArray(entries)
      ? entries.filter((entry): entry is string => typeof entry === 'string')
      : []
  if (typeof candidate.overall !== 'string' || !candidate.overall.trim()) {
    return null
  }
  return {
    overall: candidate.overall,
    maintenance: toStrings(candidate.maintenance),
    cleaning: toStrings(candidate.cleaning),
    source: candidate.source === 'ai' ? 'ai' : 'fallback',
  }
}

/** Render a legacy condition enum value as readable prose so old reports
 *  display something in the new "Condition" slot. `good` → "Good",
 *  `na` → "Not applicable". */
function prettyEnum(value: string): string {
  if (value === 'na') return 'Not applicable'
  return value.charAt(0).toUpperCase() + value.slice(1)
}

/** Single-image fetch for the cover thumbnail. */
async function fetchPhotoBytes(url: string): Promise<PhotoBytes | null> {
  const bytes = await downloadStorageBytes(url)
  return bytes ? { bytes, contentType: contentTypeFromUrl(url) } : null
}

async function fetchPhotoBytesMap(
  urls: string[]
): Promise<Map<string, PhotoBytes | null>> {
  const map = new Map<string, PhotoBytes | null>()
  await Promise.all(
    urls.map(async (url) => {
      const bytes = await downloadStorageBytes(url)
      map.set(url, bytes ? { bytes, contentType: contentTypeFromUrl(url) } : null)
    })
  )
  return map
}
