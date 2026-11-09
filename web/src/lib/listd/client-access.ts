import 'server-only'
import { and, eq } from 'drizzle-orm'
import { jobs, organisationMembers, type Tx } from '@/db'
import type { Session } from '@/lib/dal'

/** Admin, the job's client or creator, or an owner of its organisation. */
export async function canActOnClientJob(tx: Tx, session: Session, jobId: string): Promise<boolean> {
  const [job] = await tx
    .select({ clientId: jobs.clientId, createdByUserId: jobs.createdByUserId, organisationId: jobs.organisationId })
    .from(jobs)
    .where(eq(jobs.id, jobId))
    .limit(1)
  if (!job) return false
  if (session.roles.includes('admin')) return true
  if (job.clientId === session.userId || job.createdByUserId === session.userId) return true
  if (!job.organisationId) return false
  const [m] = await tx
    .select({ orgRole: organisationMembers.orgRole })
    .from(organisationMembers)
    .where(
      and(
        eq(organisationMembers.userId, session.userId),
        eq(organisationMembers.organisationId, job.organisationId),
        eq(organisationMembers.status, 'active')
      )
    )
    .limit(1)
  return m?.orgRole === 'owner'
}
