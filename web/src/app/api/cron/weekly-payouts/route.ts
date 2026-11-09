import { errorResponse, ok, unauthorized } from '@/lib/api'
import { runWeeklyPayouts } from '@/lib/listd/lifecycle'
import { verifyCronAuth } from '@/lib/webhooks'

export const runtime = 'nodejs'
export const maxDuration = 60

/** GET /api/cron/weekly-payouts: pay Pros for approved jobs. */
export async function GET(req: Request) {
  if (!verifyCronAuth(req)) return unauthorized()
  try {
    return ok(await runWeeklyPayouts())
  } catch (err) {
    console.error('[cron/weekly-payouts] error:', err)
    return errorResponse(err)
  }
}
