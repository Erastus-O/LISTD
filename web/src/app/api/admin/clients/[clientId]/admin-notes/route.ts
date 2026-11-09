import { eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { errorResponse, notFound, ok } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import { profiles, withServiceRole } from '@/db'
import { callerIp, callerUserAgent, logAuditEvent } from '@/lib/audit'

export const maxDuration = 10
export const runtime = 'nodejs'

const RequestSchema = z
  .object({
    adminNotes: z.string().trim().max(8000).nullable(),
  })
  .strict()

type Params = Promise<{ clientId: string }>

/**
 * POST /api/admin/clients/[clientId]/admin-notes — admin saves private
 * working notes on a client (`profiles.admin_notes`, added in
 * migration 0007).
 *
 * Atomic in one tx:
 *   - Updates `profiles.admin_notes` for the target user (null clears).
 *   - Writes a `pricing_override/admin_notes.updated` audit row with
 *     before/after previews. Same audit category as the job-level admin
 *     notes — both are "admin edits a non-lifecycle text field on a
 *     domain row".
 */
export async function POST(req: Request, { params }: { params: Params }) {
  const session = await authorizeRequest('admin')
  if (session instanceof Response) return session

  try {
    const { clientId } = await params
    const body = RequestSchema.parse(await req.json())
    const next = body.adminNotes?.trim() || null
    const ip = callerIp(req)
    const ua = callerUserAgent(req)

    const result = await withServiceRole(async (tx) => {
      const [target] = await tx
        .select({ userId: profiles.userId, adminNotes: profiles.adminNotes })
        .from(profiles)
        .where(eq(profiles.userId, clientId))
        .limit(1)
      if (!target) return { status: 'not_found' as const }

      const previous = target.adminNotes ?? null
      if (previous === next) return { status: 'noop' as const }

      await tx
        .update(profiles)
        .set({ adminNotes: next, updatedAt: sql`now()` })
        .where(eq(profiles.userId, clientId))

      await logAuditEvent(tx, {
        category: 'pricing_override',
        action: 'admin_notes.updated',
        actorUserId: session.userId,
        targetType: 'profile',
        targetId: clientId,
        payload: {
          field: 'admin_notes',
          previousPreview: preview(previous),
          nextPreview: preview(next),
          cleared: next === null,
        },
        ipAddress: ip,
        userAgent: ua,
      })

      return { status: 'ok' as const }
    })

    if (result.status === 'not_found') return notFound('Client not found')
    return ok({ success: true, noop: result.status === 'noop' })
  } catch (err) {
    console.error('[admin/clients/admin-notes] error:', err)
    return errorResponse(err)
  }
}

function preview(s: string | null): string | null {
  if (s === null) return null
  return s.length > 200 ? `${s.slice(0, 200)}…` : s
}
