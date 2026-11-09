import { and, asc, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
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
  organisationMembers,
  tenantDetails,
  withServiceRole,
} from '@/db'
import { callerIp, callerUserAgent, logAuditEvent } from '@/lib/audit'

export const runtime = 'nodejs'

// Confirmation is only meaningful while the job is in flight, before/around the
// inspection. Once submitted/completed the brief is locked.
const ACK_STATUSES = ['published', 'accepted', 'assigned', 'in_progress'] as const

const TenantSchema = z.object({
  fullName: z.string().trim().max(100).optional(),
  email: z.string().trim().max(200).optional(),
  phone: z.string().trim().max(50).optional(),
})

const RequestSchema = z.object({
  tenants: z.array(TenantSchema).max(10),
  accessInstructions: z.string().trim().max(2000).optional(),
})

type Params = Promise<{ jobId: string }>

/**
 * POST /api/client/jobs/[jobId]/confirm-details — the client confirms (and can
 * update) the tenant details + access instructions for an in-flight job, and
 * marks the pre-inspection brief acknowledged.
 *
 * Permission: the job's creator (owner/worker) or any active org owner.
 * Tenant rows are reconciled by order so existing `tenant_token`s (already
 * emailed to tenants) are preserved rather than regenerated.
 */
export async function POST(req: Request, { params }: { params: Params }) {
  const session = await authorizeRequest('client', 'admin')
  if (session instanceof Response) return session

  try {
    const { jobId } = await params
    const body = RequestSchema.parse(await req.json())
    const ip = callerIp(req)
    const ua = callerUserAgent(req)

    const result = await withServiceRole(async (tx) => {
      const [job] = await tx
        .select({
          status: jobs.status,
          clientId: jobs.clientId,
          createdByUserId: jobs.createdByUserId,
          organisationId: jobs.organisationId,
        })
        .from(jobs)
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
      if (!(ACK_STATUSES as readonly string[]).includes(job.status)) {
        return { status: 'wrong_state' as const, current: job.status }
      }

      // Reconcile tenant rows by order, preserving existing tokens.
      const incoming = body.tenants
        .map((t) => ({
          fullName: t.fullName?.trim() || null,
          email: t.email?.trim() || null,
          phone: t.phone?.trim() || null,
        }))
        .filter((t) => t.fullName || t.email || t.phone)

      const existing = await tx
        .select({ id: tenantDetails.id, order: tenantDetails.tenantOrder })
        .from(tenantDetails)
        .where(eq(tenantDetails.jobId, jobId))
        .orderBy(asc(tenantDetails.tenantOrder))

      for (let i = 0; i < incoming.length; i++) {
        const order = i + 1
        const match = existing.find((e) => e.order === order)
        if (match) {
          await tx
            .update(tenantDetails)
            .set({ ...incoming[i], updatedAt: sql`now()` })
            .where(eq(tenantDetails.id, match.id))
        } else {
          await tx
            .insert(tenantDetails)
            .values({ jobId, ...incoming[i], tenantOrder: order })
        }
      }
      // Drop any rows beyond the new count.
      for (const e of existing) {
        if (e.order > incoming.length) {
          await tx.delete(tenantDetails).where(eq(tenantDetails.id, e.id))
        }
      }

      await tx
        .update(jobs)
        .set({
          specialInstructions: body.accessInstructions?.trim() || null,
          clientPreInspectionAck: true,
          clientPreInspectionAckAt: sql`now()`,
          updatedAt: sql`now()`,
        })
        .where(eq(jobs.id, jobId))

      await logAuditEvent(tx, {
        category: 'job_lifecycle',
        action: 'job.pre_inspection_ack',
        actorUserId: session.userId,
        targetType: 'job',
        targetId: jobId,
        payload: { tenants: incoming.length },
        ipAddress: ip,
        userAgent: ua,
      })

      return { status: 'ok' as const }
    })

    if (result.status === 'not_found') return notFound('Job not found')
    if (result.status === 'forbidden') return forbidden('Not allowed.')
    if (result.status === 'wrong_state') {
      return conflict(
        `This job is '${result.current}' and no longer needs confirmation.`
      )
    }
    return ok({ success: true })
  } catch (err) {
    console.error('[client/jobs/confirm-details] error:', err)
    return errorResponse(err)
  }
}
