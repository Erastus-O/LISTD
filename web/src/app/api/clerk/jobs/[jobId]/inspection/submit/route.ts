import { and, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import {
  badRequest,
  conflict,
  errorResponse,
  forbidden,
  notFound,
  ok,
} from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import {
  inspectionItems,
  inspectionPhotos,
  inspectionReports,
  inspectionRooms,
  jobs,
  notifications,
  profiles,
  properties,
  reports,
  userRoles,
  withServiceRole,
} from '@/db'
import { callerIp, callerUserAgent, logAuditEvent } from '@/lib/audit'
import {
  CONDITION_RATINGS,
  renderInspectionPdf,
  type PhotoBytes,
} from '@/lib/inspection/render-pdf'
import { applyWatermark } from '@/lib/inspection/watermark'
import { formatJobReference } from '@/lib/jobs/reference'
import { ROOM_TYPES, ROOM_TYPE_LABELS } from '@/lib/inspection/build-rooms'
import { INSPECTION_TYPE_LABELS, type InspectionType } from '@/lib/pricing-matrix'
import {
  contentTypeFromUrl,
  downloadStorageBytes,
  isJobPhotoUrl,
} from '@/lib/storage/download'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { storeSignatureImage } from '@/lib/signature/store'
import {
  generateExecutiveSummary,
  type ExecutiveSummaryInput,
} from '@/lib/ai/executive-summary'

export const maxDuration = 60
export const runtime = 'nodejs'

const ItemSchema = z.object({
  itemName: z.string().trim().min(1).max(120),
  // Free-text description + condition fields. The enum `condition`
  // column + `cleanliness` column on inspection_items remain in the
  // schema for legacy reports but are not written from new captures.
  description: z.string().trim().max(2000).nullable(),
  condition: z.string().trim().max(2000).nullable(),
  photoUrls: z.array(z.string().url().max(2000)).max(20),
})

const RoomSchema = z.object({
  name: z.string().trim().min(1).max(80),
  roomType: z.enum(ROOM_TYPES),
  overallCondition: z.enum(CONDITION_RATINGS).nullable(),
  notes: z.string().trim().max(2000).nullable(),
  items: z.array(ItemSchema).max(60),
  photoUrls: z.array(z.string().url().max(2000)).max(40),
})

const RequestSchema = z
  .object({
    rooms: z.array(RoomSchema).min(1).max(40),
    generalNotes: z.string().trim().max(4000).nullable(),
    meterReadings: z
      .array(
        z.object({
          label: z.string().trim().min(1).max(60),
          // `value` (the reading itself) may legitimately be empty when
          // the meter is recorded but unreadable / not applicable —
          // the form still wants the row in the report.
          value: z.string().trim().max(120).default(''),
          serialNumber: z.string().trim().max(60).nullable().optional(),
          location: z.string().trim().max(200).nullable().optional(),
          supplier: z.string().trim().max(120).nullable().optional(),
        })
      )
      .max(20),
    smokeAlarmsChecked: z.boolean(),
    carbonMonoxideChecked: z.boolean(),
    clerkTypedName: z.string().trim().min(1).max(120),
    /** 0040 — the clerk's adopted mark as a PNG data URL. Optional so a
     *  stale open tab can still submit with a typed name alone. */
    clerkSignatureImage: z.string().max(3_000_000).nullable().optional(),
    clerkSignatureMode: z.enum(['drawn', 'styled']).nullable().optional(),
    /** ISO timestamps the form captured at start / submit. */
    inspectionStartedAt: z.string().datetime(),
    inspectionCompletedAt: z.string().datetime(),
  })
  .strict()

type Params = Promise<{ jobId: string }>

/**
 * POST /api/clerk/jobs/[jobId]/inspection/submit — clerk submits the
 * structured inspection report. Replaces the simple PDF-upload submit
 * route at /submit-report.
 *
 * Sequence:
 *   1. Validate body + hard-gate (clerk owns job, job in_progress).
 *   2. Persist inspection_reports + inspection_rooms + inspection_items +
 *      inspection_photos in one tx (no PDF yet).
 *   3. After tx commit: fetch all photo bytes via the supabase admin client,
 *      render the inspection PDF server-side with pdf-lib, and upload to
 *      `generated-reports/<jobId>/inspection-<reportId>-<ts>.pdf`.
 *   4. Final tx: write the `reports` row + flip `jobs.status='submitted'` +
 *      `jobs.report_url` + log `job_lifecycle/job.submitted` audit + notify
 *      admins (QA queue) and the client.
 *
 * The PDF render runs **after** the database persist so the structured data
 * is the source-of-truth — if the PDF fails (transient image embed error,
 * storage outage), the inspection rows are still on the row + we surface
 * the error to the clerk to retry. The job stays in `in_progress` until
 * the second tx commits.
 */
export async function POST(req: Request, { params }: { params: Params }) {
  const session = await authorizeRequest('clerk', 'trades', 'admin')
  if (session instanceof Response) return session

  try {
    const { jobId } = await params
    const body = RequestSchema.parse(await req.json())
    const allPhotos = body.rooms.flatMap((r) => [...r.photoUrls, ...r.items.flatMap((i) => i.photoUrls)])
    if (!allPhotos.every((url) => isJobPhotoUrl(url, jobId))) {
      return badRequest('A photo does not belong to this job.')
    }
    const ip = callerIp(req)
    const ua = callerUserAgent(req)

    // Store the adopted mark up front — a report must never record a
    // signature whose bytes we failed to keep.
    let clerkSignatureUrl: string | null = null
    if (body.clerkSignatureImage) {
      try {
        const stored = await storeSignatureImage({
          dataUrl: body.clerkSignatureImage,
          mode: body.clerkSignatureMode ?? 'drawn',
          scope: jobId,
          party: 'clerk',
        })
        clerkSignatureUrl = stored.url
      } catch (err) {
        return badRequest(
          err instanceof Error ? err.message : 'Could not store signature'
        )
      }
    }

    // ── 1. Persist structured inspection data ─────────────────────────────
    const persisted = await withServiceRole(async (tx) => {
      const [job] = await tx
        .select({
          id: jobs.id,
          clerkId: jobs.clerkId,
          clientId: jobs.clientId,
          status: jobs.status,
          inspectionType: jobs.inspectionType,
          propertyId: jobs.propertyId,
        })
        .from(jobs)
        .where(eq(jobs.id, jobId))
        .limit(1)
      if (!job) return { kind: 'not_found' as const }
      if (job.clerkId !== session.userId) {
        return { kind: 'forbidden' as const }
      }
      if (job.status !== 'in_progress') {
        return { kind: 'wrong_state' as const, current: job.status }
      }

      const [report] = await tx
        .insert(inspectionReports)
        .values({
          jobId,
          clerkId: session.userId,
          startedAt: body.inspectionStartedAt,
          completedAt: body.inspectionCompletedAt,
          generalNotes: body.generalNotes,
          meterReadings: body.meterReadings,
          smokeAlarmsChecked: body.smokeAlarmsChecked,
          carbonMonoxideChecked: body.carbonMonoxideChecked,
          clerkSignatureUrl,
        })
        .returning({ id: inspectionReports.id })

      const reportId = report.id

      const insertedRooms: Array<{
        id: string
        clientIndex: number
      }> = []
      for (let r = 0; r < body.rooms.length; r++) {
        const room = body.rooms[r]
        const [inserted] = await tx
          .insert(inspectionRooms)
          .values({
            reportId,
            roomType: room.roomType,
            roomName: room.name,
            roomOrder: r,
            overallCondition: room.overallCondition,
            notes: room.notes,
            completed: true,
          })
          .returning({ id: inspectionRooms.id })
        insertedRooms.push({ id: inserted.id, clientIndex: r })
      }

      // Flat list keyed by client (room, item) index so we can resolve
      // photo FKs after items insert.
      type ItemAddr = {
        roomClientIndex: number
        itemClientIndex: number
        dbId: string
      }
      const itemAddrs: ItemAddr[] = []

      for (const { id: roomId, clientIndex: r } of insertedRooms) {
        const room = body.rooms[r]
        for (let i = 0; i < room.items.length; i++) {
          const item = room.items[i]
          const [inserted] = await tx
            .insert(inspectionItems)
            .values({
              roomId,
              itemName: item.itemName,
              itemOrder: i,
              // New free-text fields map to existing text columns.
              // `condition` (enum) and `cleanliness` deliberately left
              // null on new captures — see the schema comment in
              // inspection-form / item-row for the rationale.
              description: item.description,
              conditionNotes: item.condition,
              completed: true,
            })
            .returning({ id: inspectionItems.id })
          itemAddrs.push({
            roomClientIndex: r,
            itemClientIndex: i,
            dbId: inserted.id,
          })
        }
      }

      // Photos — insert one row per photoUrl, keyed to room (and item if
      // the URL came from an item). Track distinct URLs for PDF embed.
      const allPhotoUrls = new Set<string>()
      const photoInserts: Array<{
        reportId: string
        roomId: string
        itemId: string | null
        photoUrl: string
      }> = []
      for (const { id: roomId, clientIndex: r } of insertedRooms) {
        const room = body.rooms[r]
        for (const url of room.photoUrls) {
          allPhotoUrls.add(url)
          photoInserts.push({ reportId, roomId, itemId: null, photoUrl: url })
        }
        for (let i = 0; i < room.items.length; i++) {
          const item = room.items[i]
          const itemAddr = itemAddrs.find(
            (a) => a.roomClientIndex === r && a.itemClientIndex === i
          )
          if (!itemAddr) continue
          for (const url of item.photoUrls) {
            allPhotoUrls.add(url)
            photoInserts.push({
              reportId,
              roomId,
              itemId: itemAddr.dbId,
              photoUrl: url,
            })
          }
        }
      }
      if (photoInserts.length > 0) {
        await tx.insert(inspectionPhotos).values(photoInserts)
      }

      // Property address for the PDF cover.
      const [prop] = job.propertyId
        ? await tx
            .select({
              addressLine1: properties.addressLine1,
              city: properties.city,
              postcode: properties.postcode,
              imageUrl: properties.imageUrl,
            })
            .from(properties)
            .where(eq(properties.id, job.propertyId))
            .limit(1)
        : [null]

      const [clerkProfile] = await tx
        .select({ fullName: profiles.fullName })
        .from(profiles)
        .where(eq(profiles.userId, job.clerkId))
        .limit(1)
      const [clientProfile] = await tx
        .select({
          fullName: profiles.fullName,
          companyName: profiles.companyName,
        })
        .from(profiles)
        .where(eq(profiles.userId, job.clientId))
        .limit(1)

      return {
        kind: 'ok' as const,
        reportId,
        job,
        property: prop,
        clerkName: clerkProfile?.fullName ?? null,
        clientName:
          clientProfile?.companyName ?? clientProfile?.fullName ?? null,
        photoUrls: Array.from(allPhotoUrls),
      }
    })

    if (persisted.kind === 'not_found') return notFound('Job not found')
    if (persisted.kind === 'forbidden') return forbidden('Not your job')
    if (persisted.kind === 'wrong_state') {
      return conflict(
        `Job is currently '${persisted.current}', cannot submit a report`
      )
    }

    // ── 2. Render PDF (outside tx — fetches photo bytes via admin client) ──
    // Cover thumbnail: the client's photo of the property. Best-effort —
    // a missing or unreadable one leaves the cover without it rather
    // than failing a submit the clerk is standing in the property to make.
    const clerkSignatureBytes = clerkSignatureUrl
      ? await downloadStorageBytes(clerkSignatureUrl)
      : null

    const coverUrl = persisted.property?.imageUrl ?? null
    const coverBytes = coverUrl ? await downloadStorageBytes(coverUrl) : null
    const propertyPhoto: PhotoBytes | null = coverBytes
      ? { bytes: coverBytes, contentType: contentTypeFromUrl(coverUrl!) }
      : null

    const photoBytes = new Map<string, PhotoBytes | null>()
    await Promise.all(
      persisted.photoUrls.map(async (url) => {
        const bytes = await downloadStorageBytes(url)
        photoBytes.set(
          url,
          bytes ? { bytes, contentType: contentTypeFromUrl(url) } : null
        )
      })
    )

    const addressLine = persisted.property?.addressLine1
      ? [
          persisted.property.addressLine1,
          persisted.property.city,
          persisted.property.postcode,
        ]
          .filter(Boolean)
          .join(', ')
      : 'this property'

    const inspectionLabel =
      INSPECTION_TYPE_LABELS[
        persisted.job.inspectionType as InspectionType
      ] ?? persisted.job.inspectionType

    const summaryInput: ExecutiveSummaryInput = {
      propertyAddress: addressLine,
      inspectionType: inspectionLabel,
      generalNotes: body.generalNotes,
      rooms: body.rooms.map((room, roomIndex) => ({
        name: room.name,
        overallCondition: room.overallCondition,
        items: room.items.map((item, itemIndex) => ({
          ref: `${roomIndex + 4}.${itemIndex + 1}`,
          name: item.itemName,
          description: item.description,
          condition: item.condition,
        })),
      })),
      meterReadings: body.meterReadings,
      smokeAlarmsChecked: body.smokeAlarmsChecked,
      carbonMonoxideChecked: body.carbonMonoxideChecked,
    }
    const executiveSummary = await generateExecutiveSummary(summaryInput)
    await withServiceRole((tx) =>
      tx
        .update(inspectionReports)
        .set({
          executiveSummary,
          executiveSummaryGeneratedAt: sql`now()`,
        })
        .where(eq(inspectionReports.id, persisted.reportId))
    )

    const pdfBytes = await renderInspectionPdf({
      reportLabel: formatJobReference({
        jobId,
        addressLine1: persisted.property?.addressLine1,
        postcode: persisted.property?.postcode,
      }),
      inspectionTypeLabel: inspectionLabel,
      propertyAddress: addressLine,
      clerkName: persisted.clerkName ?? 'Inspecting clerk',
      clientName: persisted.clientName ?? 'Client',
      inspectionStartedAt: new Date(body.inspectionStartedAt),
      inspectionCompletedAt: new Date(body.inspectionCompletedAt),
      generalNotes: body.generalNotes,
      meterReadings: body.meterReadings,
      smokeAlarmsChecked: body.smokeAlarmsChecked,
      carbonMonoxideChecked: body.carbonMonoxideChecked,
      executiveSummary,
      rooms: body.rooms.map((r) => ({
        name: r.name,
        roomType: r.roomType,
        overallCondition: r.overallCondition,
        notes: r.notes,
        items: r.items.map((i) => ({
          itemName: i.itemName,
          description: i.description,
          condition: i.condition,
          photoUrls: i.photoUrls,
        })),
        photoUrls: r.photoUrls,
      })),
      clerkTypedName: body.clerkTypedName,
      clerkSignature: clerkSignatureBytes
        ? { bytes: clerkSignatureBytes, contentType: 'image/png' }
        : null,
      photoBytes,
      propertyPhoto,
    })

    // Watermark the submitted copy as PROVISIONAL. The clean, watermark-free
    // official is regenerated from the persisted data at quality-review
    // approval (see lib/inspection/render-official.ts) — so no unreviewed
    // copy can ever pass as final.
    const provisionalBytes = await applyWatermark(pdfBytes)

    // ── 3. Upload PDF + flip job status + audit + notify ──────────────────
    const supabaseAdmin = getSupabaseAdmin()
    const ts = new Date().toISOString().replace(/[:.]/g, '-')
    const pdfKey = `${jobId}/inspection-${persisted.reportId}-${ts}.pdf`
    const upload = await supabaseAdmin.storage
      .from('generated-reports')
      .upload(pdfKey, Buffer.from(provisionalBytes), {
        contentType: 'application/pdf',
        upsert: false,
      })
    if (upload.error) {
      return errorResponse(
        new Error(`PDF upload failed: ${upload.error.message}`)
      )
    }
    const { data: pub } = supabaseAdmin.storage
      .from('generated-reports')
      .getPublicUrl(pdfKey)
    const reportUrl = pub.publicUrl
    // Use ROOM_TYPE_LABELS to surface readable room types in the audit
    // payload (helps QA reviewers triage without joining inspection_rooms).
    const roomsSummary = body.rooms.map((r) => ({
      name: r.name,
      type: ROOM_TYPE_LABELS[r.roomType],
      itemCount: r.items.length,
      photoCount: r.photoUrls.length + r.items.reduce(
        (n, it) => n + it.photoUrls.length,
        0
      ),
    }))
    const totalPhotos = roomsSummary.reduce((n, r) => n + r.photoCount, 0)

    const finalised = await withServiceRole(async (tx) => {
      // Optimistic-claim flip — guards against admin status overrides
      // landing between persist and finalise.
      const flipped = await tx
        .update(jobs)
        .set({
          status: 'submitted',
          reportUrl,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(jobs.id, jobId),
            eq(jobs.clerkId, session.userId),
            eq(jobs.status, 'in_progress')
          )
        )
        .returning({ id: jobs.id })
      if (flipped.length === 0) {
        return { kind: 'race' as const }
      }

      // Mirror submission timestamp on the inspection_reports row for
      // forensic ordering (started/completed on the inspection event;
      // submitted on the platform write-back).
      await tx
        .update(inspectionReports)
        .set({ submittedAt: sql`now()` })
        .where(eq(inspectionReports.id, persisted.reportId))

      // Reports row — `admin_notes` carries a structured summary so the
      // QA reviewer at /admin/quality-review/[reportId] sees it without
      // joining the inspection tables.
      const adminNotes = buildAdminNotesSummary({
        roomCount: roomsSummary.length,
        totalPhotos,
        smokeAlarmsChecked: body.smokeAlarmsChecked,
        carbonMonoxideChecked: body.carbonMonoxideChecked,
      })
      const [reportRow] = await tx
        .insert(reports)
        .values({
          jobId,
          clerkId: session.userId,
          pdfUrl: reportUrl,
          status: 'submitted',
          submittedAt: sql`now()`,
          adminNotes,
        })
        .returning({ id: reports.id })

      await logAuditEvent(tx, {
        category: 'job_lifecycle',
        action: 'job.submitted',
        actorUserId: session.userId,
        targetType: 'job',
        targetId: jobId,
        payload: {
          priorStatus: 'in_progress',
          reportId: reportRow.id,
          inspectionReportId: persisted.reportId,
          pdfKey,
          source: 'structured_inspection',
          roomCount: roomsSummary.length,
          totalPhotos,
          smokeAlarmsChecked: body.smokeAlarmsChecked,
          carbonMonoxideChecked: body.carbonMonoxideChecked,
        },
        ipAddress: ip,
        userAgent: ua,
      })

      // Notify admins + client.
      const adminRows = await tx
        .select({ userId: userRoles.userId })
        .from(userRoles)
        .where(eq(userRoles.role, 'admin'))
      const adminIds = Array.from(
        new Set(adminRows.map((a) => a.userId).filter(Boolean))
      )

      const refSlug = jobId.slice(0, 8)
      const notifs: Array<{
        userId: string
        type: string
        title: string
        message: string
        link: string
      }> = []
      for (const adminId of adminIds) {
        notifs.push({
          userId: adminId,
          type: 'job',
          title: 'Report submitted for review',
          message: `Inspection report for ${addressLine} (job ${refSlug}) is awaiting QA.`,
          link: `/admin/quality-review/${reportRow.id}`,
        })
      }
      notifs.push({
        userId: persisted.job.clientId,
        type: 'job',
        title: 'Inspection completed',
        message: `Your inspection at ${addressLine} is complete. The report is now under review.`,
        link: `/client/jobs/${jobId}`,
      })
      if (notifs.length > 0) {
        await tx.insert(notifications).values(notifs)
      }

      return { kind: 'ok' as const, reportId: reportRow.id }
    })

    if (finalised.kind === 'race') {
      return conflict('Job state changed concurrently : refresh and retry')
    }
    return ok({
      success: true,
      reportId: finalised.reportId,
      reportUrl,
    })
  } catch (err) {
    console.error('[clerk/jobs/inspection/submit] error:', err)
    return errorResponse(err)
  }
}

function buildAdminNotesSummary(s: {
  roomCount: number
  totalPhotos: number
  smokeAlarmsChecked: boolean
  carbonMonoxideChecked: boolean
}): string {
  return [
    `Rooms inspected: ${s.roomCount}`,
    `Photos: ${s.totalPhotos}`,
    `Smoke alarms checked: ${s.smokeAlarmsChecked ? 'Yes' : 'No'}`,
    `CO alarms checked: ${s.carbonMonoxideChecked ? 'Yes' : 'No'}`,
  ].join('\n')
}
