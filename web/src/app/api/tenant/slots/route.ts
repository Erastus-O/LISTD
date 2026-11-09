import { eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { badRequest, errorResponse, ok, unauthorized } from '@/lib/api'
import { jobs, withServiceRole } from '@/db'
import { logAuditEvent } from '@/lib/audit'
import { rateLimit } from '@/lib/rate-limit'
import { resolveTenantToken } from '@/lib/tenant-tokens'
import { sanitiseSlots } from '@/lib/scheduling/slots'

export const maxDuration = 20
export const runtime = 'nodejs'

const RequestSchema = z.object({
  token: z.string().min(1).max(400),
  slots: z.array(z.string().regex(/^\d{2}:\d{2}$/)).max(40),
})

/**
 * POST /api/tenant/slots — a tenant records the 30-minute inspection slot(s)
 * they're available for, within the timeframe the client booked. Token-auth'd
 * (any valid tenant token for the job), rate-limited. Slots are sanitised
 * against the job's timeframe before persisting to `jobs.tenant_selected_slots`.
 */
export async function POST(req: Request) {
  try {
    const body = RequestSchema.parse(await req.json())

    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
    const limit = await rateLimit({
      scope: 'tenant-portal-slots',
      identifier: ip ?? 'anon',
      limit: 20,
      windowSeconds: 60,
    })
    if (!limit.allowed) return badRequest('Too many requests : please wait.')

    const verdict = await resolveTenantToken(body.token, undefined, req, 'select_slots')
    if (!verdict.ok) return unauthorized()

    const result = await withServiceRole(async (tx) => {
      const [job] = await tx
        .select({
          id: jobs.id,
          preferredTimeSlot: jobs.preferredTimeSlot,
        })
        .from(jobs)
        .where(eq(jobs.id, verdict.jobId))
        .limit(1)
      if (!job) return { ok: false as const }

      const slots = sanitiseSlots(job.preferredTimeSlot, body.slots)

      await tx
        .update(jobs)
        .set({
          tenantSelectedSlots: {
            slots,
            selectedAt: new Date().toISOString(),
            tenantDetailId: verdict.tenantDetailId,
          },
          updatedAt: sql`now()`,
        })
        .where(eq(jobs.id, verdict.jobId))

      await logAuditEvent(tx, {
        category: 'tenant_portal_access',
        action: 'tenant_portal.select_slots.ok',
        actorUserId: null,
        targetType: 'job',
        targetId: verdict.jobId,
        payload: { slots, tenantDetailId: verdict.tenantDetailId },
      })

      return { ok: true as const, slots }
    })

    if (!result.ok) return badRequest('Job not found for this link.')
    return ok({ success: true, slots: result.slots })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return badRequest('Invalid request', err.flatten().fieldErrors)
    }
    console.error('[tenant/slots] error:', err)
    return errorResponse(err)
  }
}
