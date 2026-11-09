import { errorResponse } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import {
  emailLogsToCsv,
  loadEmailLogsForExport,
  parseEmailLogsFilter,
} from '@/lib/dashboard/email-logs'

export const maxDuration = 30
export const runtime = 'nodejs'

/**
 * GET /api/admin/email-logs/export — CSV export of email_logs honouring the
 * same filters as the dashboard page (M2 #12). Capped at 5 000 rows per
 * download; deeper history is a follow-up (would want streaming + paginated
 * download).
 */
export async function GET(req: Request) {
  const session = await authorizeRequest('admin')
  if (session instanceof Response) return session

  try {
    const url = new URL(req.url)
    const sp: Record<string, string> = {}
    for (const [k, v] of url.searchParams.entries()) sp[k] = v
    const filter = parseEmailLogsFilter(sp)

    const rows = await loadEmailLogsForExport(filter)
    const csv = emailLogsToCsv(rows)

    const stamp = new Date().toISOString().slice(0, 10)
    return new Response(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="email-logs-${stamp}.csv"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    console.error('[admin/email-logs/export] error:', err)
    return errorResponse(err)
  }
}
