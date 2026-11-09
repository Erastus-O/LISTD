import { and, eq, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import {
  conflict,
  errorResponse,
  forbidden,
  notFound,
  ok,
} from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import { jobs, organisationMembers, withServiceRole } from '@/db'
import { callerIp, callerUserAgent, logAuditEvent } from '@/lib/audit'
import { approveJob } from '@/lib/listd/lifecycle'
import { storeSignatureImage } from '@/lib/signature/store'
import { getEffectivePricing } from '@/lib/pricing-settings'
import { resolveSignoffPolicy } from '@/lib/pricing-matrix'

export const runtime = 'nodejs'

// A delivered report awaiting the client's signature.
// Clients approve after LISTD has reviewed the work.
const SIGNABLE = ['reviewed'] as const

const RequestSchema = z.object({
  name: z.string().trim().min(2).max(120),
  /** 0040 — the adopted mark as a PNG data URL. Optional so a client on a
   *  cached page can still sign with a typed name alone. */
  signatureImage: z.string().max(3_000_000).nullable().optional(),
  signatureMode: z.enum(['drawn', 'styled']).nullable().optional(),
})

type Params = Promise<{ jobId: string }>

/**
 * POST /api/client/jobs/[jobId]/sign-report — the client signs a delivered
 * report by typed name + confirmation. Only valid for services whose sign-off
 * policy is "client signs" (e.g. Fire Safety, EPC). Records the typed name and
 * timestamp and advances the job to `signed`.
 */
export async function POST(req: Request, { params }: { params: Params }) {
  const session = await authorizeRequest('client', 'admin')
  if (session instanceof Response) return session

  try {
    const { jobId } = await params
    const body = RequestSchema.parse(await req.json())
    const { name } = body
    const ip = callerIp(req)
    const ua = callerUserAgent(req)
    const pricing = await getEffectivePricing()

    // Store the adopted mark before the tx — the row must never claim a
    // signature whose bytes we failed to keep.
    let signatureUrl: string | null = null
    if (body.signatureImage) {
      try {
        const stored = await storeSignatureImage({
          dataUrl: body.signatureImage,
          mode: body.signatureMode ?? 'drawn',
          scope: jobId,
          party: 'client',
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
      const [job] = await tx
        .select({
          status: jobs.status,
          clientId: jobs.clientId,
          createdByUserId: jobs.createdByUserId,
          organisationId: jobs.organisationId,
          inspectionType: jobs.inspectionType,
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

      const policy = resolveSignoffPolicy(
        job.inspectionType,
        pricing.customTypes
      )
      if (policy.signoffBy !== 'client') {
        return { status: 'policy' as const }
      }
      if (!(SIGNABLE as readonly string[]).includes(job.status)) {
        return { status: 'wrong_state' as const, current: job.status }
      }

      await tx
        .update(jobs)
        .set({
          clientReportAccepted: true,
          clientReportAcceptedAt: sql`now()`,
          clientSignatureName: name,
          clientSignatureUrl: signatureUrl,
          clientSignatureAt: sql`now()`,
          updatedAt: sql`now()`,
        })
        .where(and(eq(jobs.id, jobId), inArray(jobs.status, [...SIGNABLE])))

      // Signing is the client's approval of the finished job.
      const approved = await approveJob(tx, { jobId, mode: 'client', actorId: session.userId })
      if (!approved.ok) {
        if (approved.code === 'disputed') return { status: 'disputed' as const }
        return { status: 'wrong_state' as const, current: job.status }
      }

      await logAuditEvent(tx, {
        category: 'job_lifecycle',
        action: 'job.client_signed',
        actorUserId: session.userId,
        targetType: 'job',
        targetId: jobId,
        payload: {
          signatureName: name,
          signatureMode: body.signatureMode ?? null,
          signatureStored: Boolean(signatureUrl),
        },
        ipAddress: ip,
        userAgent: ua,
      })
      return { status: 'ok' as const }
    })

    if (result.status === 'not_found') return notFound('Job not found')
    if (result.status === 'disputed') {
      return Response.json({ error: 'This job has an open dispute. It can be approved once the dispute is settled.' }, { status: 409 })
    }
    if (result.status === 'forbidden') return forbidden('Not allowed.')
    if (result.status === 'policy') {
      return conflict('This report is signed by the tenant, not the client.')
    }
    if (result.status === 'wrong_state') {
      return conflict(
        `This report is '${result.current}' and can't be signed from here.`
      )
    }
    return ok({ success: true })
  } catch (err) {
    console.error('[client/jobs/sign-report] error:', err)
    return errorResponse(err)
  }
}
