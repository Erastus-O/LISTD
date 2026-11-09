import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { errorResponse, notFound, noContent } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import { jobs, withServiceRole } from '@/db'
import { callerIp, callerUserAgent, logAuditEvent } from '@/lib/audit'

export const maxDuration = 15
export const runtime = 'nodejs'

/**
 * Numeric pricing fields an admin can override on a job. Each is independently
 * optional in the request body; only the keys present in the request are
 * touched. The `numeric` column type round-trips as string in Drizzle, so we
 * coerce to a string with two decimals before the UPDATE.
 */
const Money = z
  .union([z.number().finite(), z.string().trim().min(1)])
  .transform((v) => {
    const n = typeof v === 'number' ? v : Number(v)
    if (!Number.isFinite(n)) throw new Error('Invalid number')
    return n
  })
  .pipe(z.number().min(0).max(1_000_000))

const RequestSchema = z
  .object({
    quotedPrice: Money.optional(),
    finalPrice: Money.optional(),
    clerkPayout: Money.optional(),
    clerkBonus: Money.optional(),
    clerkFinalPayout: Money.optional(),
    /** Optional human-readable rationale stored on the audit row. */
    reason: z.string().trim().max(500).optional(),
  })
  .strict()
  .refine(
    (b) =>
      b.quotedPrice !== undefined ||
      b.finalPrice !== undefined ||
      b.clerkPayout !== undefined ||
      b.clerkBonus !== undefined ||
      b.clerkFinalPayout !== undefined,
    { message: 'At least one pricing field required' }
  )

type Params = Promise<{ jobId: string }>

const FIELD_TO_COLUMN = {
  quotedPrice: jobs.quotedPrice,
  finalPrice: jobs.finalPrice,
  clerkPayout: jobs.clerkPayout,
  clerkBonus: jobs.clerkBonus,
  clerkFinalPayout: jobs.clerkFinalPayout,
} as const

type FieldKey = keyof typeof FIELD_TO_COLUMN

/**
 * POST /api/admin/jobs/[jobId]/pricing-override — admin overrides one or more
 * job pricing fields (S6b of the Lovable port; closes M1 #22 Package C
 * `pricing_override` sites — finding F5 in the audit-events review).
 *
 * Per-field diff-log: one `pricing_override/pricing.override.<field>` audit
 * row per field that actually changed. No-op writes (same value) are skipped
 * for both the UPDATE and the audit row, mirroring the platform-settings
 * handler's pattern. Update + audit rows live in the same `withServiceRole`
 * tx so a partial failure cannot produce a price change without the matching
 * forensic record.
 *
 * Lovable's existing `EditablePrice` (AdminJobDetail.tsx) currently writes
 * directly via the Supabase client — to wire it through this handler, replace
 * `handleSaveField` with a `fetch('/api/admin/jobs/' + jobId + '/pricing-override',
 * { method: 'POST', body: JSON.stringify({ [field]: value }) })`. Until that
 * Lovable-side change lands, the Lovable UI keeps writing direct (unaudited)
 * and this handler is the path the future Next-side AdminJobDetail page will
 * call.
 */
export async function POST(req: Request, { params }: { params: Params }) {
  const session = await authorizeRequest('admin')
  if (session instanceof Response) return session

  try {
    const { jobId } = await params
    const body = RequestSchema.parse(await req.json())
    const ip = callerIp(req)
    const ua = callerUserAgent(req)

    const result = await withServiceRole(async (tx) => {
      // Pre-read for the diff. Locking via FOR UPDATE would block concurrent
      // admin edits; the audit row has the actor + timestamp so a clean
      // reconstruction is possible from the log even if two admins overlap.
      const [existing] = await tx
        .select({
          quotedPrice: jobs.quotedPrice,
          finalPrice: jobs.finalPrice,
          clerkPayout: jobs.clerkPayout,
          clerkBonus: jobs.clerkBonus,
          clerkFinalPayout: jobs.clerkFinalPayout,
        })
        .from(jobs)
        .where(eq(jobs.id, jobId))
        .limit(1)
      if (!existing) return { status: 'not_found' as const }

      const updates: Partial<Record<FieldKey, string>> = {}
      const changed: Array<{ field: FieldKey; before: string | null; after: string }> = []

      for (const field of Object.keys(FIELD_TO_COLUMN) as FieldKey[]) {
        const next = body[field]
        if (next === undefined) continue
        const nextStr = next.toFixed(2)
        const beforeStr = existing[field] ?? null
        // Compare numerically so '350' vs '350.00' don't read as a change.
        const beforeNum = beforeStr === null ? null : Number(beforeStr)
        if (beforeNum !== null && Number.isFinite(beforeNum) && beforeNum === next) {
          continue
        }
        updates[field] = nextStr
        changed.push({ field, before: beforeStr, after: nextStr })
      }

      if (changed.length === 0) {
        return { status: 'noop' as const }
      }

      await tx.update(jobs).set(updates).where(eq(jobs.id, jobId))

      for (const { field, before, after } of changed) {
        await logAuditEvent(tx, {
          category: 'pricing_override',
          action: `pricing.override.${field}`,
          actorUserId: session.userId,
          targetType: 'job',
          targetId: jobId,
          payload: {
            field,
            before,
            after,
            reason: body.reason ?? null,
          },
          ipAddress: ip,
          userAgent: ua,
        })
      }

      return { status: 'ok' as const, changed: changed.map((c) => c.field) }
    })

    if (result.status === 'not_found') return notFound('Job not found')
    if (result.status === 'noop') return noContent()
    return Response.json({ updated: result.changed }, { status: 200 })
  } catch (err) {
    console.error('[admin/jobs/pricing-override] error:', err)
    return errorResponse(err)
  }
}
