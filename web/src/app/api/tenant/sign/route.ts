import { and, eq, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'
import { errorResponse, ok, unauthorized } from '@/lib/api'
import {
  generatedReports,
  tenantDetails,
  withServiceRole,
} from '@/db'
import { logAuditEvent } from '@/lib/audit'
import { storeSignatureImage } from '@/lib/signature/store'
import { rateLimit } from '@/lib/rate-limit'
import { renderAndStoreSignedPdf } from '@/lib/signed-pdf-pipeline'
import {
  resolveTenantToken,
  rotateTenantToken,
} from '@/lib/tenant-tokens'

export const maxDuration = 30
export const runtime = 'nodejs'

const RequestSchema = z.object({
  reportId: z.string().uuid(),
  token: z.string().min(1),
  signature: z.string().trim().min(2).max(100),
  /** 0040 — the adopted mark as a PNG data URL. Optional so a signature
   *  posted by an older client (or a re-signed link opened from a cached
   *  page) still records the typed name rather than failing outright. */
  signatureImage: z.string().max(3_000_000).nullable().optional(),
  signatureMode: z.enum(['drawn', 'styled']).nullable().optional(),
})

/**
 * POST /api/tenant/sign — record a tenant's typed-name signature against a
 * `generated_reports` row (M3 #5).
 *
 * Trust boundary:
 *   1. Token must resolve via `resolveTenantToken` with `sign_report` scope.
 *   2. The reportId must belong to the resolved token's job.
 *   3. The typed signature must match the tenant's full_name on file
 *      (case-insensitive). Mismatch → 400; same UX hint as the form.
 *
 * On success:
 *   - `generated_reports.tenant_signature` set to the typed name; `signed_at` = now()
 *   - `audit_events` row in `tenant_portal_access` with `tenant_portal.sign_report.ok`
 *   - **Token is rotated** (per roadmap Q4 default) — the previous token
 *     stays valid for the 5-minute grace window so the UI can `router.refresh()`
 *     without losing access mid-flow. Caller receives the new token in the
 *     response body so the SPA can update the URL if desired.
 *
 * **PDF re-render with embedded signature is deferred to S3b** — for now the
 * `report_url` continues to point at the original unsigned PDF. The signed
 * status + signature text on `generated_reports` is enough to drive the
 * "Signed" UI badge.
 */
export async function POST(req: Request) {
  try {
    const body = RequestSchema.parse(await req.json())

    // Rate limit on the IP — keeps a brute-force token guesser from spamming
    // sign attempts even with a token they don't own.
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
    const limit = await rateLimit({
      scope: 'tenant-portal-sign',
      identifier: ip ?? 'anon',
      limit: 6,
      windowSeconds: 60,
      failClosed: true,
    })
    if (!limit.allowed) {
      return new Response('Too many requests', {
        status: 429,
        headers: { 'retry-after': String(limit.retryAfterSeconds || 1) },
      })
    }

    const verdict = await resolveTenantToken(body.token, 'sign_report', req, 'sign_report')
    if (!verdict.ok) {
      // Map all token failures to 401 — don't leak which specific reason
      // (revoked vs expired vs unknown) to an unauthenticated caller.
      return unauthorized()
    }

    // Store the adopted mark BEFORE the tx, so the row can never claim a
    // signature whose bytes we failed to keep. The reverse — an orphan PNG
    // in a private bucket when the tx then rejects the name — costs a few
    // KB and nothing else.
    let signatureUrl: string | null = null
    if (body.signatureImage) {
      try {
        const stored = await storeSignatureImage({
          dataUrl: body.signatureImage,
          mode: body.signatureMode ?? 'drawn',
          scope: verdict.jobId,
          party: 'tenant',
        })
        signatureUrl = stored.url
      } catch (err) {
        return Response.json(
          {
            error:
              err instanceof Error ? err.message : 'Could not store signature',
          },
          { status: 400 }
        )
      }
    }

    const result = await withServiceRole(async (tx) => {
      // 1) Fetch the report and confirm it belongs to this token's job.
      const [reportRow] = await tx
        .select({
          id: generatedReports.id,
          jobId: generatedReports.jobId,
          signedAt: generatedReports.signedAt,
        })
        .from(generatedReports)
        .where(eq(generatedReports.id, body.reportId))
        .limit(1)
      if (!reportRow || reportRow.jobId !== verdict.jobId) {
        return { ok: false as const, reason: 'report_not_found' }
      }
      if (reportRow.signedAt !== null) {
        return { ok: false as const, reason: 'already_signed' }
      }

      // 2) Pull the tenant's full_name. Signature must match.
      const [tenantRow] = verdict.tenantDetailId
        ? await tx
            .select({ fullName: tenantDetails.fullName })
            .from(tenantDetails)
            .where(eq(tenantDetails.id, verdict.tenantDetailId))
            .limit(1)
        : await tx
            .select({ fullName: tenantDetails.fullName })
            .from(tenantDetails)
            .where(eq(tenantDetails.jobId, verdict.jobId))
            .limit(1)

      const expected = (tenantRow?.fullName ?? '').trim().toLowerCase()
      if (!expected) {
        return { ok: false as const, reason: 'no_tenant_name' }
      }
      if (body.signature.trim().toLowerCase() !== expected) {
        return { ok: false as const, reason: 'signature_mismatch' }
      }

      // 3) Stamp the signature. The double WHERE clause on signedAt is
      // belt-and-braces against a concurrent sign — if another request
      // already signed, this UPDATE is a no-op and we treat it as
      // already_signed below.
      const updated = await tx
        .update(generatedReports)
        .set({
          tenantSignature: body.signature.trim(),
          tenantSignatureUrl: signatureUrl,
          signedAt: sql`now()`,
        })
        .where(
          and(
            eq(generatedReports.id, body.reportId),
            isNull(generatedReports.signedAt)
          )
        )
        .returning({ id: generatedReports.id })

      if (updated.length === 0) {
        return { ok: false as const, reason: 'already_signed' }
      }

      // 4) Audit row inside the same tx.
      await logAuditEvent(tx, {
        category: 'tenant_portal_access',
        action: 'tenant_portal.sign_report.ok',
        actorUserId: null,
        targetType: 'generated_report',
        targetId: body.reportId,
        payload: {
          actor: 'tenant',
          jobId: verdict.jobId,
          tenantDetailId: verdict.tenantDetailId,
          // How the mark was produced — evidential context if the
          // signature is ever challenged.
          signatureMode: body.signatureMode ?? null,
          signatureStored: Boolean(signatureUrl),
        },
        ipAddress: ip,
        userAgent: req.headers.get('user-agent'),
      })

      return { ok: true as const }
    })

    if (!result.ok) {
      const status =
        result.reason === 'signature_mismatch' ||
        result.reason === 'no_tenant_name'
          ? 400
          : result.reason === 'report_not_found'
            ? 404
            : 409 // already_signed
      return Response.json({ error: result.reason }, { status })
    }

    // 5) PDF re-render with embedded signatures (M3 #6 / #7 — S3b). Runs
    //    after the sign tx commits, so a re-render failure cannot block the
    //    user-facing sign success. The pipeline writes its own audit row
    //    (`tenant_portal.signed_pdf.rendered` on success or
    //    `tenant_portal.signed_pdf.render_failed` on failure) — we don't
    //    need to surface either to the tenant.
    const renderResult = await renderAndStoreSignedPdf({
      reportId: body.reportId,
      jobId: verdict.jobId,
      tenantTypedName: body.signature.trim(),
      tenantSignedAt: new Date(),
    })
    if (!renderResult.ok) {
      console.warn(
        `[tenant/sign] signed-PDF re-render failed for report ${body.reportId}: ${renderResult.reason}`
      )
    }

    // 6) Rotate the token. The previous token remains valid for ~5 min via
    // the grace-window check in `resolveTenantToken`, so an immediate
    // `router.refresh()` from the SPA still resolves before the rotation
    // takes effect URL-side.
    const rotation = await rotateTenantToken(body.token).catch(() => null)
    return ok({
      success: true,
      newToken: rotation?.ok ? rotation.token : null,
      signedPdfRendered: renderResult.ok,
    })
  } catch (err) {
    console.error('[tenant/sign] error:', err)
    return errorResponse(err)
  }
}
