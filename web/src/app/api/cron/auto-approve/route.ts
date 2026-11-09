import { errorResponse, ok, unauthorized } from '@/lib/api'
import { autoApproveDueJobs } from '@/lib/listd/lifecycle'
import { expireQuotes } from '@/lib/listd/quotes'
import { verifyCronAuth } from '@/lib/webhooks'

export const runtime = 'nodejs'
export const maxDuration = 60

/** GET /api/cron/auto-approve: close review windows and expire old quotes. */
export async function GET(req: Request) {
  if (!verifyCronAuth(req)) return unauthorized()
  try {
    const approved = await autoApproveDueJobs()
    const expired = await expireQuotes()
    return ok({ ...approved, expiredQuotes: expired })
  } catch (err) {
    console.error('[cron/auto-approve] error:', err)
    return errorResponse(err)
  }
}
