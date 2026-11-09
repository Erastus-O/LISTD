import { eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import {
  badRequest,
  errorResponse,
  notFound,
  ok,
} from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import { notificationAutomationSettings, withServiceRole } from '@/db'
import { callerIp, callerUserAgent, logAuditEvent } from '@/lib/audit'
import { bustAutomationSettings } from '@/lib/dashboard/admin-notifications'

export const maxDuration = 10
export const runtime = 'nodejs'

const RequestSchema = z
  .object({
    value: z.number().min(-1_000_000).max(1_000_000),
  })
  .strict()

type Params = Promise<{ id: string }>

/**
 * POST /api/admin/notifications/automation/[id] — update one row in
 * `notification_automation_settings`.
 *
 * Settings drive recurring background jobs (job recycling cadence, upsell
 * reminder windows, invoice chasers). Each save writes
 * `platform_setting/notification_automation.updated` with the previous +
 * next value so the audit log shows exactly which knob was turned and by
 * how much.
 */
export async function POST(req: Request, { params }: { params: Params }) {
  const session = await authorizeRequest('admin')
  if (session instanceof Response) return session

  try {
    const { id } = await params
    const body = RequestSchema.parse(await req.json())
    if (!Number.isFinite(body.value)) {
      return badRequest('Value must be a finite number')
    }
    const ip = callerIp(req)
    const ua = callerUserAgent(req)

    const result = await withServiceRole(async (tx) => {
      const [existing] = await tx
        .select({
          id: notificationAutomationSettings.id,
          settingKey: notificationAutomationSettings.settingKey,
          value: notificationAutomationSettings.value,
          label: notificationAutomationSettings.label,
          category: notificationAutomationSettings.category,
        })
        .from(notificationAutomationSettings)
        .where(eq(notificationAutomationSettings.id, id))
        .limit(1)
      if (!existing) return { status: 'not_found' as const }

      const nextValueStr = String(body.value)
      if (existing.value === nextValueStr) {
        return { status: 'noop' as const }
      }

      await tx
        .update(notificationAutomationSettings)
        .set({
          value: nextValueStr,
          updatedAt: sql`now()`,
          updatedBy: session.userId,
        })
        .where(eq(notificationAutomationSettings.id, id))

      await logAuditEvent(tx, {
        category: 'platform_setting',
        action: 'notification_automation.updated',
        actorUserId: session.userId,
        targetType: 'notification_automation_settings',
        targetId: id,
        payload: {
          settingKey: existing.settingKey,
          category: existing.category,
          label: existing.label,
          previousValue: existing.value,
          nextValue: nextValueStr,
        },
        ipAddress: ip,
        userAgent: ua,
      })

      return { status: 'ok' as const }
    })

    if (result.status === 'not_found') return notFound('Setting not found')
    if (result.status === 'ok') await bustAutomationSettings()
    return ok({ success: true, noop: result.status === 'noop' })
  } catch (err) {
    console.error('[admin/notifications/automation] error:', err)
    return errorResponse(err)
  }
}
