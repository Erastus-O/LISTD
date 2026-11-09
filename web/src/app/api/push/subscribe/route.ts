import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { badRequest, errorResponse, ok } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import { pushSubscriptions, withServiceRole } from '@/db'

export const runtime = 'nodejs'
export const maxDuration = 15

const SubscribeSchema = z.object({
  endpoint: z.string().url().max(1000),
  keys: z.object({
    p256dh: z.string().min(1).max(500),
    auth: z.string().min(1).max(500),
  }),
})

const UnsubscribeSchema = z.object({ endpoint: z.string().url().max(1000) })

/**
 * POST /api/push/subscribe — register (or refresh) the caller's Web Push
 * subscription for desktop/web notifications. Upserts by `endpoint` (the
 * unique key) so re-subscribing the same browser updates the keys + owner
 * rather than erroring.
 */
export async function POST(req: Request) {
  const session = await authorizeRequest()
  if (session instanceof Response) return session
  try {
    const { endpoint, keys } = SubscribeSchema.parse(await req.json())
    const userAgent = req.headers.get('user-agent')?.slice(0, 400) ?? null

    await withServiceRole(async (tx) => {
      await tx
        .insert(pushSubscriptions)
        .values({
          userId: session.userId,
          endpoint,
          p256dh: keys.p256dh,
          auth: keys.auth,
          source: 'web',
          userAgent,
        })
        .onConflictDoUpdate({
          target: pushSubscriptions.endpoint,
          set: {
            userId: session.userId,
            p256dh: keys.p256dh,
            auth: keys.auth,
            source: 'web',
            userAgent,
            lastError: null,
            lastErrorAt: null,
          },
        })
    })
    return ok({ success: true })
  } catch (err) {
    if (err instanceof z.ZodError) return badRequest('Invalid subscription')
    console.error('[push/subscribe] error:', err)
    return errorResponse(err)
  }
}

/**
 * DELETE /api/push/subscribe — remove the caller's subscription for a given
 * endpoint (when they turn desktop notifications off).
 */
export async function DELETE(req: Request) {
  const session = await authorizeRequest()
  if (session instanceof Response) return session
  try {
    const { endpoint } = UnsubscribeSchema.parse(await req.json())
    await withServiceRole(async (tx) => {
      await tx
        .delete(pushSubscriptions)
        .where(
          and(
            eq(pushSubscriptions.endpoint, endpoint),
            eq(pushSubscriptions.userId, session.userId)
          )
        )
    })
    return ok({ success: true })
  } catch (err) {
    if (err instanceof z.ZodError) return badRequest('Invalid request')
    console.error('[push/subscribe] DELETE error:', err)
    return errorResponse(err)
  }
}
