import { authorizeRequest } from '@/lib/dal'
import { handleSiteEvent } from '@/lib/site-events'

export const maxDuration = 15
export const runtime = 'nodejs'

type Params = Promise<{ jobId: string }>

/**
 * POST /api/clerk/jobs/[jobId]/site-events — the assigned clerk files an
 * on-site event: arrival check-in, running-late flag, or no-access report.
 * Validation, notifications and audit live in `@/lib/site-events` (shared
 * with the cleaner route).
 */
export async function POST(req: Request, { params }: { params: Params }) {
  const session = await authorizeRequest('clerk', 'trades', 'admin')
  if (session instanceof Response) return session

  const { jobId } = await params
  return handleSiteEvent({ req, jobId, userId: session.userId, role: 'clerk' })
}
