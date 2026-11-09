import 'server-only'
import { eq } from 'drizzle-orm'
import {
  db,
  generatedReports,
  inspectionReports,
  jobs,
  properties,
  withServiceRole,
} from '@/db'
import { logAuditEvent } from '@/lib/audit'
import { INSPECTION_TYPE_LABELS, type InspectionType } from '@/lib/pricing-matrix'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { appendSignaturePage, type SignaturePartyImage } from '@/lib/signed-pdf'
import {
  contentTypeFromUrl,
  downloadStorageBytes,
} from '@/lib/storage/download'

/**
 * End-to-end pipeline for generating the signed PDF after a tenant signature
 * lands (M3 #6 / #7 / S3b). Sequence:
 *
 *   1. Fetch the original PDF bytes (private bucket → admin client download).
 *   2. Fetch the clerk + client signature images (admin client when stored
 *      in Supabase, plain `fetch` otherwise).
 *   3. Append a signature page using `appendSignaturePage`.
 *   4. Upload to a fresh key in `generated-reports` — original retained.
 *   5. Update `generated_reports.report_url` to the new key's public URL.
 *   6. Audit row `tenant_portal_access/report.signed_pdf_rendered`.
 *
 * The whole sequence is **best-effort**. If anything fails after the
 * signature has been recorded on the row (rare), we audit the failure with
 * `report.signed_pdf_render_failed` and let the caller proceed — the
 * source-of-truth is the row + audit log, not the PDF artifact.
 *
 * Caller is the [`/api/tenant/sign`](../app/api/tenant/sign/route.ts) handler;
 * it invokes this **after** the sign tx commits so a re-render failure cannot
 * block the user-facing sign success.
 */
export async function renderAndStoreSignedPdf(params: {
  reportId: string
  jobId: string
  tenantTypedName: string
  tenantSignedAt: Date
}): Promise<
  | { ok: true; newReportUrl: string }
  | { ok: false; reason: string }
> {
  const { reportId, jobId } = params
  const supabaseAdmin = getSupabaseAdmin()

  try {
    // 1. Pull the row context we need: current report URL + clerk/client
    //    signature URLs + property address + inspection type.
    const ctx = await db.transaction(async (tx) => {
      const [row] = await tx
        .select({
          reportUrl: generatedReports.reportUrl,
          tenantSignatureUrl: generatedReports.tenantSignatureUrl,
          jobInspectionType: jobs.inspectionType,
          jobClientSignatureUrl: jobs.clientSignatureUrl,
          propertyAddress: properties.addressLine1,
          propertyPostcode: properties.postcode,
        })
        .from(generatedReports)
        .innerJoin(jobs, eq(jobs.id, generatedReports.jobId))
        .leftJoin(properties, eq(properties.id, jobs.propertyId))
        .where(eq(generatedReports.id, reportId))
        .limit(1)
      if (!row) return null

      const [inspection] = await tx
        .select({ clerkSignatureUrl: inspectionReports.clerkSignatureUrl })
        .from(inspectionReports)
        .where(eq(inspectionReports.jobId, jobId))
        .limit(1)

      return {
        reportUrl: row.reportUrl,
        clerkSignatureUrl: inspection?.clerkSignatureUrl ?? null,
        clientSignatureUrl: row.jobClientSignatureUrl,
        tenantSignatureUrl: row.tenantSignatureUrl,
        inspectionType: row.jobInspectionType,
        addressLine: [row.propertyAddress, row.propertyPostcode]
          .filter(Boolean)
          .join(', '),
      }
    })
    if (!ctx) return { ok: false, reason: 'context_not_found' }
    if (!ctx.reportUrl) return { ok: false, reason: 'no_original_pdf' }

    // 2. Download the original PDF.
    const originalBytes = await downloadStorageBytes(ctx.reportUrl)
    if (!originalBytes) {
      return { ok: false, reason: 'original_pdf_download_failed' }
    }

    // 3. Pull all three signature images in parallel — failure is
    //    non-fatal, `appendSignaturePage` falls back to the typed name
    //    (tenant) or a "(signature on file)" label (clerk / client).
    const [clerk, client, tenant] = await Promise.all([
      ctx.clerkSignatureUrl
        ? downloadSignatureImage(ctx.clerkSignatureUrl)
        : Promise.resolve(null),
      ctx.clientSignatureUrl
        ? downloadSignatureImage(ctx.clientSignatureUrl)
        : Promise.resolve(null),
      ctx.tenantSignatureUrl
        ? downloadSignatureImage(ctx.tenantSignatureUrl)
        : Promise.resolve(null),
    ])

    // 4. Re-render.
    const inspectionLabel =
      INSPECTION_TYPE_LABELS[ctx.inspectionType as InspectionType] ??
      ctx.inspectionType
    const newPdfBytes = await appendSignaturePage({
      originalPdfBytes: originalBytes,
      reportLabel: ctx.addressLine || `Job ${jobId.slice(0, 8)}`,
      inspectionTypeLabel: inspectionLabel,
      clerk,
      client,
      tenant,
      tenantTypedName: params.tenantTypedName,
      tenantSignedAt: params.tenantSignedAt,
    })

    // 5. Upload to a fresh key. Convention: `<jobId>/signed-<reportId>-<isoZ>.pdf`.
    //    We DO NOT delete the original — supersede + retain (M3 #7).
    const ts = params.tenantSignedAt.toISOString().replace(/[:.]/g, '-')
    const newKey = `${jobId}/signed-${reportId}-${ts}.pdf`
    const uploadRes = await supabaseAdmin.storage
      .from('generated-reports')
      .upload(newKey, Buffer.from(newPdfBytes), {
        contentType: 'application/pdf',
        upsert: false,
      })
    if (uploadRes.error) {
      return {
        ok: false,
        reason: `upload_failed: ${uploadRes.error.message}`,
      }
    }
    const { data: pub } = supabaseAdmin.storage
      .from('generated-reports')
      .getPublicUrl(newKey)
    const newReportUrl = pub.publicUrl

    // 6. Update + audit row in a single tx — partial failure can't leave a
    //    `report_url` flip without the matching forensic record.
    await withServiceRole(async (tx) => {
      await tx
        .update(generatedReports)
        .set({ reportUrl: newReportUrl })
        .where(eq(generatedReports.id, reportId))

      await logAuditEvent(tx, {
        category: 'tenant_portal_access',
        action: 'tenant_portal.signed_pdf.rendered',
        actorUserId: null,
        targetType: 'generated_report',
        targetId: reportId,
        payload: {
          actor: 'tenant',
          jobId,
          newKey,
          previousReportUrl: ctx.reportUrl,
          tenantTypedName: params.tenantTypedName,
          rendererVersion: 1,
        },
      })
    })

    return { ok: true, newReportUrl }
  } catch (err) {
    // Best-effort path: write a failure audit row so support can find it.
    try {
      await withServiceRole(async (tx) => {
        await logAuditEvent(tx, {
          category: 'tenant_portal_access',
          action: 'tenant_portal.signed_pdf.render_failed',
          actorUserId: null,
          targetType: 'generated_report',
          targetId: reportId,
          payload: {
            jobId,
            error: err instanceof Error ? err.message : 'unknown',
          },
        })
      })
    } catch {
      /* swallow — we already failed; logging the failure record is best-effort too */
    }
    return {
      ok: false,
      reason: err instanceof Error ? err.message : 'render_failed',
    }
  }
}

async function downloadSignatureImage(
  url: string
): Promise<SignaturePartyImage | null> {
  const bytes = await downloadStorageBytes(url)
  if (!bytes) return null
  return { bytes, contentType: contentTypeFromUrl(url) }
}
