import { revalidateTag } from 'next/cache'
import { z } from 'zod'
import { inArray, sql } from 'drizzle-orm'
import { errorResponse, noContent } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import { platformSettings, withServiceRole } from '@/db'
import { callerIp, callerUserAgent, logAuditEvent } from '@/lib/audit'

export const maxDuration = 15
export const runtime = 'nodejs'

// Whitelist of platform_settings keys writable from the admin UI. Adding a
// new public-facing setting? Add the key here AND surface it in the form at
// `src/app/admin/settings/admin-settings-form.tsx`.
const VALUE = z.string().max(20_000).optional()

const RequestSchema = z
  .object({
    trustpilot_enabled: VALUE,
    trustpilot_embed_code: VALUE,
    trustpilot_review_link: VALUE,
    instagram_url: VALUE,
    facebook_url: VALUE,
    linkedin_url: VALUE,
    tiktok_url: VALUE,
    x_url: VALUE,
    whatsapp_url: VALUE,
  })
  .strict()

type AllowedKey = keyof z.infer<typeof RequestSchema>

/**
 * PATCH /api/admin/platform-settings — upsert one or more platform_settings
 * rows by `key`. Admin only.
 *
 * Body is a partial object of allowed keys → string values. An empty string
 * clears the value (the column is nullable but we store '' to keep the row
 * present and the audit trail intact).
 */
export async function PATCH(req: Request) {
  const session = await authorizeRequest('admin')
  if (session instanceof Response) return session

  try {
    const body = await req.json()
    const parsed = RequestSchema.parse(body)

    const updates = Object.entries(parsed).filter(
      ([, v]) => v !== undefined
    ) as Array<[AllowedKey, string]>

    if (updates.length === 0) return noContent()

    const ip = callerIp(req)
    const ua = callerUserAgent(req)

    // Service-role bypass: this handler is admin-gated, and platform_settings
    // is a small singleton-style table where each row is keyed by a known
    // string. Drizzle's onConflictDoUpdate hits the unique constraint on `key`.
    await withServiceRole(async (tx) => {
      // Pre-read existing values so the audit row carries before/after.
      const keys = updates.map(([k]) => k)
      const existingRows = await tx
        .select({
          key: platformSettings.key,
          value: platformSettings.value,
        })
        .from(platformSettings)
        .where(inArray(platformSettings.key, keys))
      const existingMap = new Map(existingRows.map((r) => [r.key, r.value ?? null]))

      for (const [key, value] of updates) {
        const before = existingMap.get(key) ?? null
        if (before === value) continue // No-op write — skip both upsert and audit row.

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

        await logAuditEvent(tx, {
          category: 'platform_setting',
          action: 'platform_setting.updated',
          actorUserId: session.userId,
          targetType: 'platform_setting',
          targetId: key,
          payload: { key, before, after: value },
          ipAddress: ip,
          userAgent: ua,
        })
      }
    })

    // Mark cached reads (footer social links, Trustpilot section) for
    // immediate expiration so the next visit sees fresh data instead of
    // waiting up to an hour for the unstable_cache TTL.
    revalidateTag('platform-settings', { expire: 0 })

    return noContent()
  } catch (err) {
    console.error('[admin/platform-settings] error:', err)
    return errorResponse(err)
  }
}
