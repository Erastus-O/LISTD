import { and, desc, eq, gte, lt, type SQL } from 'drizzle-orm'
import { badRequest, errorResponse, ok } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import { appLogs, withServiceRole } from '@/db'
import { getSupabaseAdmin } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 20

const CHANNELS = ['payment', 'application', 'error'] as const
const LEVELS = ['debug', 'info', 'warn', 'error'] as const
const SIGNED_TTL_SECONDS = 60 * 10

/**
 * GET /api/admin/logs — admin troubleshooting access to the operational logs.
 *
 *   - `?date=YYYY-MM-DD&channel=payment` → 302 to a short-lived signed URL for
 *     that day's archived NDJSON file in the private `logs` bucket.
 *   - otherwise → recent rows straight from `app_logs`, filterable by
 *     `channel`, `level`, and `limit` (default 100, max 500).
 */
export async function GET(req: Request) {
  const session = await authorizeRequest('admin')
  if (session instanceof Response) return session

  try {
    const url = new URL(req.url)
    const channelParam = url.searchParams.get('channel')
    const channel =
      channelParam && (CHANNELS as readonly string[]).includes(channelParam)
        ? (channelParam as (typeof CHANNELS)[number])
        : null
    const date = url.searchParams.get('date')

    // Archived-file access → signed URL.
    if (date) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return badRequest('date must be YYYY-MM-DD')
      }
      if (!channel) return badRequest('channel is required with date')
      const admin = getSupabaseAdmin()
      const { data, error } = await admin.storage
        .from('logs')
        .createSignedUrl(`${channel}/${date}.jsonl`, SIGNED_TTL_SECONDS)
      if (error || !data?.signedUrl) {
        return badRequest(`No log file for ${channel}/${date}`)
      }
      return Response.json({ url: data.signedUrl })
    }

    // Live tail from the table.
    const levelParam = url.searchParams.get('level')
    const level =
      levelParam && (LEVELS as readonly string[]).includes(levelParam)
        ? (levelParam as (typeof LEVELS)[number])
        : null
    const limit = Math.min(
      Math.max(Number(url.searchParams.get('limit') ?? 100) || 100, 1),
      500
    )
    const since = url.searchParams.get('since') // ISO; optional
    const until = url.searchParams.get('until')

    const clauses: SQL[] = []
    if (channel) clauses.push(eq(appLogs.channel, channel))
    if (level) clauses.push(eq(appLogs.level, level))
    if (since) clauses.push(gte(appLogs.ts, since))
    if (until) clauses.push(lt(appLogs.ts, until))

    const rows = await withServiceRole((tx) =>
      tx
        .select()
        .from(appLogs)
        .where(clauses.length ? and(...clauses) : undefined)
        .orderBy(desc(appLogs.ts))
        .limit(limit)
    )

    return ok({ count: rows.length, rows })
  } catch (err) {
    console.error('[admin/logs] error:', err)
    return errorResponse(err)
  }
}
