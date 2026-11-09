import { eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { errorResponse, notFound, ok } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import { reportTemplates, withServiceRole } from '@/db'
import { callerIp, callerUserAgent, logAuditEvent } from '@/lib/audit'
import { bustReportTemplates } from '@/lib/dashboard/admin-report-templates'

export const maxDuration = 10
export const runtime = 'nodejs'

const RequestSchema = z.object({ isActive: z.boolean() }).strict()

type Params = Promise<{ id: string }>

/**
 * POST /api/admin/report-templates/[id]/toggle — flip `is_active`.
 *
 * Active templates are visible to clerks via the RLS read policy; inactive
 * ones are hidden but retained for re-activation later. Each flip writes
 * `platform_setting/report_template.<activated|deactivated>` so the audit
 * trail shows who put a template back into circulation.
 */
export async function POST(req: Request, { params }: { params: Params }) {
  const session = await authorizeRequest('admin')
  if (session instanceof Response) return session

  try {
    const { id } = await params
    const body = RequestSchema.parse(await req.json())
    const ip = callerIp(req)
    const ua = callerUserAgent(req)

    const result = await withServiceRole(async (tx) => {
      const [existing] = await tx
        .select({
          id: reportTemplates.id,
          isActive: reportTemplates.isActive,
          name: reportTemplates.name,
        })
        .from(reportTemplates)
        .where(eq(reportTemplates.id, id))
        .limit(1)
      if (!existing) return { status: 'not_found' as const }
      if (existing.isActive === body.isActive) {
        return { status: 'noop' as const }
      }

      await tx
        .update(reportTemplates)
        .set({ isActive: body.isActive, updatedAt: sql`now()` })
        .where(eq(reportTemplates.id, id))

      await logAuditEvent(tx, {
        category: 'platform_setting',
        action: body.isActive
          ? 'report_template.activated'
          : 'report_template.deactivated',
        actorUserId: session.userId,
        targetType: 'report_template',
        targetId: id,
        payload: { name: existing.name },
        ipAddress: ip,
        userAgent: ua,
      })
      return { status: 'ok' as const }
    })

    if (result.status === 'not_found') return notFound('Template not found')
    if (result.status === 'ok') await bustReportTemplates()
    return ok({ success: true, noop: result.status === 'noop' })
  } catch (err) {
    console.error('[admin/report-templates/toggle] error:', err)
    return errorResponse(err)
  }
}
