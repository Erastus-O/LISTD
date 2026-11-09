import { z } from 'zod'
import { badRequest, errorResponse, ok } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import { logAuditEvent } from '@/lib/audit'
import { withServiceRole } from '@/db'
import { saveAiSettings } from '@/lib/ai/settings'
import {
  AI_TEXT_MODEL_OPTIONS,
  AI_VISION_MODEL_OPTIONS,
} from '@/lib/ai/openrouter'

export const runtime = 'nodejs'
export const maxDuration = 10

const Schema = z
  .object({
    visionModel: z.enum(
      AI_VISION_MODEL_OPTIONS.map((m) => m.id) as [string, ...string[]]
    ),
    textModel: z.enum(
      AI_TEXT_MODEL_OPTIONS.map((m) => m.id) as [string, ...string[]]
    ),
  })
  .strict()

/**
 * PUT /api/admin/ai/settings — admin updates the per-capability model
 * picks. Both fields are validated against their curated lists so a
 * non-vision model can never land on a vision agent's path (and vice
 * versa). Writes a `platform_setting/ai_config.updated` audit row.
 */
export async function PUT(req: Request) {
  const session = await authorizeRequest('admin')
  if (session instanceof Response) return session
  try {
    const body = Schema.parse(await req.json())
    await saveAiSettings({
      visionModel: body.visionModel,
      textModel: body.textModel,
    })
    await withServiceRole(async (tx) =>
      logAuditEvent(tx, {
        category: 'platform_setting',
        action: 'ai_config.updated',
        actorUserId: session.userId,
        targetType: 'platform_setting',
        targetId: 'ai_config',
        payload: {
          visionModel: body.visionModel,
          textModel: body.textModel,
        },
      })
    )
    return ok({ success: true })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return badRequest('Invalid model selection', err.flatten().fieldErrors)
    }
    console.error('[admin/ai/settings] error:', err)
    return errorResponse(err)
  }
}
