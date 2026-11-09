import { and, eq, sql } from 'drizzle-orm'
import {
  conflict,
  errorResponse,
  forbidden,
  notFound,
  ok,
} from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import {
  jobs,
  notifications,
  organisationMembers,
  properties,
  userRoles,
  withServiceRole,
} from '@/db'
import { callerIp, callerUserAgent, logAuditEvent } from '@/lib/audit'
import { getEffectivePricing } from '@/lib/pricing-settings'
import { resolveSignoffPolicy } from '@/lib/pricing-matrix'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { FROM_NOTIFICATIONS, getResend, logEmail } from '@/lib/resend'

export const runtime = 'nodejs'

// The report must be delivered for the client to acknowledge receipt.
const READY = ['submitted', 'reviewed', 'signed', 'completed', 'paid']

type Params = Promise<{ jobId: string }>

/**
 * POST /api/client/jobs/[jobId]/acknowledge-report — for TENANT-signed services
 * where the client must confirm read & receipt. Records the timestamp and
 * notifies admin (in-app + email). No status change — the tenant is the
 * signatory; this is the client's receipt.
 */
export async function POST(req: Request, { params }: { params: Params }) {
  const session = await authorizeRequest('client', 'admin')
  if (session instanceof Response) return session

  try {
    const { jobId } = await params
    const ip = callerIp(req)
    const ua = callerUserAgent(req)
    const pricing = await getEffectivePricing()

    const result = await withServiceRole(async (tx) => {
      const [job] = await tx
        .select({
          status: jobs.status,
          clientId: jobs.clientId,
          createdByUserId: jobs.createdByUserId,
          organisationId: jobs.organisationId,
          inspectionType: jobs.inspectionType,
          acknowledgedAt: jobs.clientReportAcknowledgedAt,
          address: properties.addressLine1,
          city: properties.city,
        })
        .from(jobs)
        .leftJoin(properties, eq(properties.id, jobs.propertyId))
        .where(eq(jobs.id, jobId))
        .limit(1)
      if (!job) return { status: 'not_found' as const }

      const isAdmin = session.roles.includes('admin')
      const isCreator =
        job.createdByUserId === session.userId ||
        job.clientId === session.userId
      let isOwner = false
      if (job.organisationId) {
        const [m] = await tx
          .select({ orgRole: organisationMembers.orgRole })
          .from(organisationMembers)
          .where(
            and(
              eq(organisationMembers.userId, session.userId),
              eq(organisationMembers.organisationId, job.organisationId),
              eq(organisationMembers.status, 'active')
            )
          )
          .limit(1)
        isOwner = m?.orgRole === 'owner'
      }
      if (!isAdmin && !isCreator && !isOwner) {
        return { status: 'forbidden' as const }
      }

      const policy = resolveSignoffPolicy(
        job.inspectionType,
        pricing.customTypes
      )
      if (!policy.clientAckRequired) {
        return { status: 'policy' as const }
      }
      if (!READY.includes(job.status)) {
        return { status: 'wrong_state' as const, current: job.status }
      }
      if (job.acknowledgedAt) {
        // Already acknowledged — treat as success (idempotent).
        return { status: 'already' as const }
      }

      await tx
        .update(jobs)
        .set({
          clientReportAcknowledgedAt: sql`now()`,
          updatedAt: sql`now()`,
        })
        .where(eq(jobs.id, jobId))

      await logAuditEvent(tx, {
        category: 'job_lifecycle',
        action: 'job.client_acknowledged_report',
        actorUserId: session.userId,
        targetType: 'job',
        targetId: jobId,
        payload: {},
        ipAddress: ip,
        userAgent: ua,
      })

      // In-app notify every admin (within the tx so it commits atomically).
      const admins = await tx
        .select({ userId: userRoles.userId })
        .from(userRoles)
        .where(eq(userRoles.role, 'admin'))
      const adminIds = admins
        .map((a) => a.userId)
        .filter((id): id is string => Boolean(id))
      const address =
        job.address && job.city ? `${job.address}, ${job.city}` : null
      if (adminIds.length > 0) {
        await tx.insert(notifications).values(
          adminIds.map((userId) => ({
            userId,
            type: 'report',
            title: 'Client acknowledged report receipt',
            message: `Job ${jobId.slice(0, 8)}${
              address ? ` · ${address}` : ''
            } — the client confirmed they read & received the report.`,
            link: `/admin/jobs/${jobId}`,
          }))
        )
      }

      return { status: 'ok' as const, adminIds, address }
    })

    if (result.status === 'not_found') return notFound('Job not found')
    if (result.status === 'forbidden') return forbidden('Not allowed.')
    if (result.status === 'policy') {
      return conflict('This report does not require client acknowledgement.')
    }
    if (result.status === 'wrong_state') {
      return conflict('The report isn’t available to acknowledge yet.')
    }
    if (result.status === 'already') return ok({ success: true })

    // Email admins (best-effort, outside the tx).
    void emailAdmins(result.adminIds, jobId, result.address)

    return ok({ success: true })
  } catch (err) {
    console.error('[client/jobs/acknowledge-report] error:', err)
    return errorResponse(err)
  }
}

async function emailAdmins(
  adminIds: string[],
  jobId: string,
  address: string | null
): Promise<void> {
  if (adminIds.length === 0) return
  try {
    const admin = getSupabaseAdmin()
    const recipients: string[] = []
    for (const id of adminIds) {
      const u = await admin.auth.admin.getUserById(id)
      if (u.data?.user?.email) recipients.push(u.data.user.email)
    }
    if (recipients.length === 0) return
    const subject = `Client acknowledged report receipt — job ${jobId.slice(0, 8)}`
    const html = `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;padding:32px 20px;">
        <h1 style="color:#18181b;font-size:20px;margin:0 0 12px;">Report receipt acknowledged</h1>
        <p style="color:#52525b;font-size:15px;line-height:1.5;margin:0 0 8px;">The client confirmed they have read and received the report for job <strong>${jobId.slice(0, 8)}</strong>${address ? ` (${address})` : ''}.</p>
        <p style="color:#a1a1aa;font-size:13px;margin-top:16px;">Recorded automatically with a timestamp on the job record.</p>
      </div>`.trim()
    await Promise.allSettled(
      recipients.map((to) =>
        getResend().emails.send({
          from: FROM_NOTIFICATIONS,
          to: [to],
          subject,
          html,
        })
      )
    )
    await logEmail({
      functionName: 'client-report-acknowledged',
      recipientEmails: recipients,
      subject,
      resendId: null,
      errorMessage: null,
      metadata: { jobId },
    })
  } catch (err) {
    console.warn('[acknowledge-report] admin email failed:', err)
  }
}
