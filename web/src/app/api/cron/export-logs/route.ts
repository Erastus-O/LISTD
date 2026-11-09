import { and, asc, eq, gte, lt } from 'drizzle-orm'
import { errorResponse, ok, unauthorized } from '@/lib/api'
import { appLogs, withServiceRole } from '@/db'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { verifyCronAuth, verifyExternalApiKey } from '@/lib/webhooks'

export const maxDuration = 60
export const runtime = 'nodejs'

const CHANNELS = ['payment', 'application', 'error'] as const
// Keep rows queryable for this long after they're archived to the bucket.
const RETENTION_DAYS = 30

/**
 * GET /api/cron/export-logs — daily rollup of the previous UTC day's
 * `app_logs` rows into per-channel NDJSON files in the private `logs` bucket
 * (`<channel>/<YYYY-MM-DD>.jsonl`), then prune rows older than RETENTION_DAYS.
 *
 * Idempotent: the upload upserts, so a re-run overwrites the same day's file.
 * Vercel Cron: daily at 00:10 UTC (vercel.json).
 */
export async function GET(req: Request) {
  if (!verifyCronAuth(req) && !verifyExternalApiKey(req)) {
    return unauthorized()
  }

  try {
    const now = new Date()
    const startToday = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
    )
    const startYesterday = new Date(startToday.getTime() - 24 * 60 * 60 * 1000)
    const dateStr = startYesterday.toISOString().slice(0, 10)
    const startIso = startYesterday.toISOString()
    const endIso = startToday.toISOString()

    const admin = getSupabaseAdmin()
    const exported: Record<string, number> = {}
    const uploadErrors: Record<string, string> = {}

    for (const channel of CHANNELS) {
      const rows = await withServiceRole((tx) =>
        tx
          .select()
          .from(appLogs)
          .where(
            and(
              eq(appLogs.channel, channel),
              gte(appLogs.ts, startIso),
              lt(appLogs.ts, endIso)
            )
          )
          .orderBy(asc(appLogs.ts))
      )
      exported[channel] = rows.length
      if (rows.length === 0) continue

      const ndjson =
        rows
          .map((r) =>
            JSON.stringify({
              ts: r.ts,
              level: r.level,
              channel: r.channel,
              event: r.event,
              message: r.message,
              context: r.context,
              requestId: r.requestId,
              actorUserId: r.actorUserId,
              route: r.route,
            })
          )
          .join('\n') + '\n'

      const key = `${channel}/${dateStr}.jsonl`
      const up = await admin.storage
        .from('logs')
        .upload(key, Buffer.from(ndjson, 'utf8'), {
          contentType: 'application/x-ndjson',
          upsert: true,
        })
      if (up.error) uploadErrors[channel] = up.error.message
    }

    // Retention — drop rows older than the window (already archived).
    const cutoffIso = new Date(
      startToday.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000
    ).toISOString()
    const pruned = await withServiceRole((tx) =>
      tx.delete(appLogs).where(lt(appLogs.ts, cutoffIso)).returning({
        id: appLogs.id,
      })
    )

    return ok({
      date: dateStr,
      exported,
      uploadErrors,
      pruned: pruned.length,
    })
  } catch (err) {
    console.error('[cron/export-logs] error:', err)
    return errorResponse(err)
  }
}
