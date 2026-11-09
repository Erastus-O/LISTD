import { eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { errorResponse, notFound, ok, serverError } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import {
  db,
  jobs,
  notifications,
  profiles,
  properties,
  reports,
  withServiceRole,
} from '@/db'
import { callerIp, callerUserAgent, logAuditEvent } from '@/lib/audit'
import { notifyUserSms } from '@/lib/notify-prefs'
import { sendPushToUser } from '@/lib/push'
import { releaseToClient } from '@/lib/listd/lifecycle'
import { getPricing } from '@/lib/listd/pricing-settings'
import { issueEscrowReceiptForJob } from '@/lib/billing/escrow-receipt'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { renderOfficialReportForJob } from '@/lib/inspection/render-official'
import { emailTenantsReportReady } from '@/lib/tenant-report-ready'

// Approval re-renders the clean official PDF (re-downloads photos), so this
// can run longer than the other QA decisions.
export const maxDuration = 60
export const runtime = 'nodejs'

const RequestSchema = z
  .object({
    decision: z.enum(['approve', 'return', 'reject']),
    /** Required for `return` and `reject`; optional for `approve` (admin
     *  notes still saved when present). */
    notes: z.string().trim().max(2000).optional(),
  })
  .strict()
  .refine(
    (b) => b.decision === 'approve' || (b.notes && b.notes.length > 0),
    {
      message: 'Notes are required when returning or rejecting',
      path: ['notes'],
    }
  )

type Params = Promise<{ reportId: string }>

/**
 * POST /api/admin/quality-review/[reportId]/decision — admin reviewer makes
 * the final call on a submitted report (S6d-3). Three outcomes:
 *
 *   - **approve** → `reports.status='approved'` + `jobs.status='reviewed'`, opening the client's approval window (payment is released after they approve)
 *     + audit `job_lifecycle/job.completed` (closes the lifecycle audit
 *     site for completion via the QA route — admins reaching `mark-completed`
 *     manually from the job detail also write this same action, but the QA
 *     payload carries `via='quality_review'` so paths stay distinguishable).
 *     Notifies client (report ready) + clerk (payment queued).
 *
 *   - **return** → `reports.status='returned'` + `jobs.status='in_progress'`
 *     + audit `job_lifecycle/job.in_progress` with `reason='returned_for_amends'`.
 *     Notifies clerk with the reviewer's narrative.
 *
 *   - **reject** → `reports.status='rejected'` (job status untouched — admin
 *     decides the next state via the job detail status-override route) +
 *     audit `job_lifecycle/report.rejected`. Notifies clerk.
 *
 * All mutations + audit row land in one tx so a partial failure cannot
 * leave a status flip without the matching forensic record.
 */
export async function POST(req: Request, { params }: { params: Params }) {
  const session = await authorizeRequest('admin')
  if (session instanceof Response) return session

  try {
    const { reportId } = await params
    const body = RequestSchema.parse(await req.json())
    const ip = callerIp(req)
    const ua = callerUserAgent(req)
    const pricing = await getPricing()

    // On approval, regenerate the watermark-free official PDF from the
    // persisted inspection data and upload it BEFORE the transaction — the
    // render re-downloads photos, so it must not run while a DB tx is open.
    // Fail closed: if the official can't be produced, don't approve.
    let officialUrl: string | null = null
    if (body.decision === 'approve') {
      const [pre] = await db
        .select({ jobId: reports.jobId, status: reports.status })
        .from(reports)
        .where(eq(reports.id, reportId))
        .limit(1)
      if (!pre) return notFound('Report not found')
      if (pre.status !== 'submitted') {
        return Response.json(
          {
            error: 'invalid_state',
            message: `Report is currently '${pre.status}', cannot decide`,
          },
          { status: 409 }
        )
      }
      if (pre.jobId) {
        let officialBytes: Uint8Array | null = null
        try {
          officialBytes = await renderOfficialReportForJob(pre.jobId)
        } catch (err) {
          console.error('[quality-review] official render failed:', err)
          return serverError(
            'Could not generate the official report : please retry.'
          )
        }
        // `null` = legacy report with no structured data; leave the existing
        // PDF in place rather than blanking it.
        if (officialBytes) {
          const admin = getSupabaseAdmin()
          const ts = new Date().toISOString().replace(/[:.]/g, '-')
          const key = `${pre.jobId}/inspection-official-${ts}.pdf`
          const up = await admin.storage
            .from('generated-reports')
            .upload(key, Buffer.from(officialBytes), {
              contentType: 'application/pdf',
              upsert: false,
            })
          if (up.error) {
            return serverError(
              `Official report upload failed: ${up.error.message}`
            )
          }
          officialUrl = admin.storage
            .from('generated-reports')
            .getPublicUrl(key).data.publicUrl
        }
      }
    }

    const result = await withServiceRole(async (tx) => {
      const [row] = await tx
        .select({
          id: reports.id,
          jobId: reports.jobId,
          clerkId: reports.clerkId,
          status: reports.status,
        })
        .from(reports)
        .where(eq(reports.id, reportId))
        .limit(1)
      if (!row) return { status: 'not_found' as const }
      if (row.status !== 'submitted') {
        return { status: 'invalid_state' as const, current: row.status }
      }

      const jobContext = row.jobId
        ? await tx
            .select({
              id: jobs.id,
              clientId: jobs.clientId,
              status: jobs.status,
              addressLine1: properties.addressLine1,
              postcode: properties.postcode,
            })
            .from(jobs)
            .leftJoin(properties, eq(properties.id, jobs.propertyId))
            .where(eq(jobs.id, row.jobId))
            .limit(1)
            .then((rs) => rs[0] ?? null)
        : null

      const addr =
        jobContext?.addressLine1
          ? `${jobContext.addressLine1}${
              jobContext.postcode ? ', ' + jobContext.postcode : ''
            }`
          : 'a property'

      if (body.decision === 'approve') {
        await tx
          .update(reports)
          .set({
            status: 'approved',
            approvedAt: sql`now()`,
            adminNotes: body.notes ?? null,
            // Swap the provisional link for the freshly rendered official.
            ...(officialUrl ? { pdfUrl: officialUrl } : {}),
          })
          .where(eq(reports.id, reportId))

        if (jobContext) {
          // Approving here means LISTD's review passed. The client now has the
          // review window; payment is only payable once they approve.
          const released = await releaseToClient(tx, {
            jobId: jobContext.id,
            actorId: session.userId,
            reviewHours: pricing.reviewHours,
            reportUrl: officialUrl,
            via: 'quality_review',
            notes: body.notes ?? null,
          })
          if (!released.ok) {
            return { status: 'invalid_state' as const, current: jobContext.status }
          }
          if (row.clerkId) {
            await tx.insert(notifications).values({
              userId: row.clerkId,
              type: 'job',
              title: 'Report passed LISTD review',
              message: `Your report for ${addr} has gone to the client to approve.`,
              link: `/clerk/earnings`,
            })
          }
        }

        return {
          status: 'ok' as const,
          decision: 'approve' as const,
          // Carried out of the tx so the "report ready" SMS fires after
          // commit (never holds the connection during the Twilio call).
          smsClient: jobContext
            ? { userId: jobContext.clientId, addr, jobId: jobContext.id }
            : null,
        }
      }

      if (body.decision === 'return') {
        await tx
          .update(reports)
          .set({
            status: 'returned',
            adminNotes: body.notes,
          })
          .where(eq(reports.id, reportId))

        if (jobContext) {
          await tx
            .update(jobs)
            .set({ status: 'in_progress' })
            .where(eq(jobs.id, jobContext.id))

          await logAuditEvent(tx, {
            category: 'job_lifecycle',
            action: 'job.in_progress',
            actorUserId: session.userId,
            targetType: 'job',
            targetId: jobContext.id,
            payload: {
              priorStatus: jobContext.status,
              reason: 'returned_for_amends',
              reportId,
              notes: body.notes,
            },
            ipAddress: ip,
            userAgent: ua,
          })

          if (row.clerkId) {
            await tx.insert(notifications).values({
              userId: row.clerkId,
              type: 'job',
              title: 'Report returned for amends',
              message: `Your report for ${addr} requires changes: ${body.notes}`,
              link: `/clerk/jobs/${jobContext.id}`,
            })
          }
        }

        return { status: 'ok' as const, decision: 'return' as const }
      }

      // reject — keep job status untouched (admin decides next state
      // separately via the existing job status-override handler).
      await tx
        .update(reports)
        .set({
          status: 'rejected',
          adminNotes: body.notes,
        })
        .where(eq(reports.id, reportId))

      if (jobContext) {
        await logAuditEvent(tx, {
          category: 'job_lifecycle',
          action: 'report.rejected',
          actorUserId: session.userId,
          targetType: 'job',
          targetId: jobContext.id,
          payload: {
            priorStatus: jobContext.status,
            reportId,
            notes: body.notes,
          },
          ipAddress: ip,
          userAgent: ua,
        })

        if (row.clerkId) {
          await tx.insert(notifications).values({
            userId: row.clerkId,
            type: 'job',
            title: 'Report rejected',
            message: `Your report for ${addr} was rejected: ${body.notes}`,
            link: `/clerk/jobs/${jobContext.id}`,
          })
        }
      }

      return { status: 'ok' as const, decision: 'reject' as const }
    })

    if (result.status === 'not_found') return notFound('Report not found')
    if (result.status === 'invalid_state') {
      return Response.json(
        {
          error: 'invalid_state',
          message: `Report is currently '${result.current}', cannot decide`,
        },
        { status: 409 }
      )
    }

    // Report-ready SMS to the client when QA approves (gated by their
    // `smsJobUpdates` pref + phone). Best-effort, post-commit.
    if (result.decision === 'approve' && result.smsClient) {
      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://listd.pro'
      const { userId, addr, jobId } = result.smsClient
      const smsBody = `LISTD: Your inspection report for ${addr} is approved and ready to view & sign off. ${siteUrl}/client/jobs/${jobId}`
      await notifyUserSms(userId, 'smsJobUpdates', smsBody)

      // Desktop/web push to the client (best-effort; no-ops without VAPID).
      await sendPushToUser(userId, {
        title: 'Report ready',
        body: `Your job at ${addr} is ready to approve.`,
        url: `/client/jobs/${jobId}`,
        tag: `report:${jobId}:ready`,
      })

      // Email each tenant on the job their private sign-off portal link.
      // Best-effort, post-commit (mints a token + sends via Resend).
      await emailTenantsReportReady({
        jobId,
        address: addr,
        issuedBy: session.userId,
      }).catch((e) =>
        console.warn('[quality-review] tenant report-ready emails failed:', e)
      )

      // Issue the client's paid invoice + email their receipt (they paid into
      // escrow at booking). Best-effort, idempotent, post-commit: a failure
      // here must not undo the approval.
      const receipt = await issueEscrowReceiptForJob(jobId, session.userId).catch(
        () => ({ issued: false, reason: 'error' as const })
      )
      if (
        !receipt.issued &&
        receipt.reason !== 'already_invoiced' &&
        receipt.reason !== 'no_settled_escrow'
      ) {
        console.warn(
          `[quality-review] escrow receipt not issued for job ${jobId}:`,
          receipt.reason
        )
      }
    }

    return ok({ success: true, decision: result.decision })
  } catch (err) {
    console.error('[admin/quality-review/decision] error:', err)
    return errorResponse(err)
  }
}
