import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { errorResponse, ok } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import { platformSettings, withServiceRole } from '@/db'
import { callerIp, callerUserAgent, logAuditEvent } from '@/lib/audit'
import { bustAnnouncementBanner } from '@/lib/dashboard/admin-notifications'

export const maxDuration = 10
export const runtime = 'nodejs'

const RequestSchema = z
  .object({
    enabled: z.boolean(),
    text: z.string().trim().max(500),
    expiresAt: z.string().trim().max(50),
    target: z.enum(['all', 'clients', 'clerks']),
  })
  .strict()

/**
 * POST /api/admin/notifications/banner — save the four `platform_settings`
 * keys that drive the platform announcement banner.
 *
 * Stored as separate rows for back-compat with the existing settings hook
 * (`usePlatformSettings`) which reads key/value scalars. The Lovable
 * version did its own per-key upsert; we batch under one tx with an
 * audit row covering the whole save.
 */
export async function POST(req: Request) {
  const session = await authorizeRequest('admin')
  if (session instanceof Response) return session

  try {
    const body = RequestSchema.parse(await req.json())
    const ip = callerIp(req)
    const ua = callerUserAgent(req)

    const pairs: Array<{ key: string; value: string }> = [
      { key: 'announcement_enabled', value: body.enabled ? 'true' : 'false' },
      { key: 'announcement_text', value: body.text },
      { key: 'announcement_expires', value: body.expiresAt },
      { key: 'announcement_target', value: body.target },
    ]

    await withServiceRole(async (tx) => {
      for (const { key, value } of pairs) {
        await tx
          .insert(platformSettings)
          .values({
            key,
            value,
            updatedBy: session.userId,
            updatedAt: sql`now()`,
          })
          .onConflictDoUpdate({
            target: platformSettings.key,
            set: {
              value,
              updatedBy: session.userId,
              updatedAt: sql`now()`,
            },
          })
      }

      await logAuditEvent(tx, {
        category: 'platform_setting',
        action: 'announcement_banner.updated',
        actorUserId: session.userId,
        targetType: 'platform_settings',
        targetId: 'announcement_banner',
        payload: {
          enabled: body.enabled,
          textPreview:
            body.text.length > 120 ? `${body.text.slice(0, 120)}…` : body.text,
          target: body.target,
          expiresAt: body.expiresAt || null,
        },
        ipAddress: ip,
        userAgent: ua,
      })
    })

    await bustAnnouncementBanner()
    return ok({ success: true })
  } catch (err) {
    console.error('[admin/notifications/banner] error:', err)
    return errorResponse(err)
  }
}
