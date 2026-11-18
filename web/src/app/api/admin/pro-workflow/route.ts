import { z } from 'zod'
import { errorResponse, ok } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import { withServiceRole } from '@/db'
import { logAuditEvent } from '@/lib/audit'
import { saveProWorkflow } from '@/lib/listd/pro-workflow'

export const runtime = 'nodejs'

const Body = z
  .object({
    autoApproveFromLevel: z.number().int().min(0).max(3),
    clientChat: z.boolean(),
    platformRules: z.string().trim().min(1).max(4000),
  })
  .strict()

/** POST /api/admin/pro-workflow: approval, chat and platform rules settings. */
export async function POST(req: Request) {
  const session = await authorizeRequest('admin')
  if (session instanceof Response) return session
  try {
    const body = Body.parse(await req.json())
    await saveProWorkflow(body)
    await withServiceRole((tx) =>
      logAuditEvent(tx, {
        category: 'pricing_override',
        action: 'settings.pro_workflow_updated',
        actorUserId: session.userId,
        targetType: 'platform_setting',
        targetId: 'pro_workflow',
        payload: { autoApproveFromLevel: body.autoApproveFromLevel, clientChat: body.clientChat },
      })
    )
    return ok({ success: true })
  } catch (err) {
    console.error('[admin/pro-workflow] error:', err)
    return errorResponse(err)
  }
}
