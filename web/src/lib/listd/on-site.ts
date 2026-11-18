import 'server-only'
import { and, eq, sql } from 'drizzle-orm'
import { jobSiteEvents, jobs, type Tx } from '@/db'

/**
 * On-site rules for the simplified Pro journey:
 *   start  needs LISTD's approval and a check-in with a photo of the front of the building
 *   finish needs a check-out with a photo of the building
 * Jobs approved before these rules (listd_approval_mode 'legacy') are exempt, so
 * nothing already in flight gets stuck. Admins acting for a Pro skip the checks.
 * Null means go ahead; otherwise the reason to show.
 */

async function hasEventWithPhoto(tx: Tx, jobId: string, kind: 'arrival' | 'check_out') {
  const [row] = await tx
    .select({ id: jobSiteEvents.id })
    .from(jobSiteEvents)
    .where(and(eq(jobSiteEvents.jobId, jobId), eq(jobSiteEvents.kind, kind), sql`jsonb_array_length(${jobSiteEvents.photoPaths}) > 0`))
    .limit(1)
  return Boolean(row)
}

async function approval(tx: Tx, jobId: string) {
  const [job] = await tx
    .select({ at: jobs.listdApprovedAt, mode: jobs.listdApprovalMode })
    .from(jobs)
    .where(eq(jobs.id, jobId))
    .limit(1)
  return job ?? null
}

export async function startBlock(tx: Tx, jobId: string, isAdmin = false): Promise<string | null> {
  if (isAdmin) return null
  const a = await approval(tx, jobId)
  if (!a) return 'Job not found.'
  if (!a.at) return 'LISTD hasn’t approved this booking yet.'
  if (a.mode === 'legacy') return null
  return (await hasEventWithPhoto(tx, jobId, 'arrival')) ? null : 'Check in with a photo of the front of the building first.'
}

export async function finishBlock(tx: Tx, jobId: string, isAdmin = false): Promise<string | null> {
  if (isAdmin) return null
  const a = await approval(tx, jobId)
  if (!a || a.mode === 'legacy') return null
  return (await hasEventWithPhoto(tx, jobId, 'check_out')) ? null : 'Check out with a photo of the building before you finish.'
}
