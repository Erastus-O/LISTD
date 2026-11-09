import { eq } from 'drizzle-orm'
import { errorResponse, notFound, ok } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import { reportTemplates, withServiceRole } from '@/db'
import { callerIp, callerUserAgent, logAuditEvent } from '@/lib/audit'
import { bustReportTemplates } from '@/lib/dashboard/admin-report-templates'

export const maxDuration = 10
export const runtime = 'nodejs'

type Params = Promise<{ id: string }>

/**
 * POST /api/admin/report-templates/[id]/delete — hard-delete a report
 * template. Templates are admin-curated content; once a clerk has used
 * one to seed an inspection, the resulting inspection_rooms/items rows are
 * independent copies — deleting a template doesn't cascade into past
 * inspections.
 *
 * Writes `platform_setting/report_template.deleted` inside the tx so the
 * forensic trail survives the row. `audit_events.target_id` is plain text
 * with no FK, so this works the same way the job-delete handler does.
 */
export async function POST(req: Request, { params }: { params: Params }) {
  const session = await authorizeRequest('admin')
  if (session instanceof Response) return session

  try {
    const { id } = await params
    const ip = callerIp(req)
    const ua = callerUserAgent(req)

    const result = await withServiceRole(async (tx) => {
      const [existing] = await tx
        .select({
          id: reportTemplates.id,
          name: reportTemplates.name,
          isActive: reportTemplates.isActive,
        })
        .from(reportTemplates)
        .where(eq(reportTemplates.id, id))
        .limit(1)
      if (!existing) return { status: 'not_found' as const }

      await logAuditEvent(tx, {
        category: 'platform_setting',
        action: 'report_template.deleted',
        actorUserId: session.userId,
        targetType: 'report_template',
        targetId: id,
        payload: {
          name: existing.name,
          isActive: existing.isActive,
        },
        ipAddress: ip,
        userAgent: ua,
      })

      await tx.delete(reportTemplates).where(eq(reportTemplates.id, id))
      return { status: 'ok' as const }
    })

    if (result.status === 'not_found') return notFound('Template not found')
    await bustReportTemplates()
    return ok({ success: true })
  } catch (err) {
    console.error('[admin/report-templates/delete] error:', err)
    return errorResponse(err)
  }
}
