import 'server-only'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { jobs, userRoles, type Tx } from '@/db'
import { PRO_SERVICES, PRO_SERVICE_ROLES, type ProServiceRole } from './pro-services'

const OPEN = ['accepted', 'assigned', 'in_progress', 'submitted', 'reviewed'] as const

/** Open jobs a Pro holds in a service, so dropping it can't strand them. */
async function hasOpenJobs(tx: Tx, userId: string, role: ProServiceRole): Promise<boolean> {
  const kind =
    role === 'cleaner'
      ? sql`${jobs.inspectionType} like 'clean\_%'`
      : role === 'trades'
        ? sql`${jobs.inspectionType} = 'repairs'`
        : sql`${jobs.inspectionType} not like 'clean\_%' and ${jobs.inspectionType} <> 'repairs'`
  const [row] = await tx
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(sql`(${jobs.clerkId} = ${userId} or ${jobs.cleanerId} = ${userId})`, inArray(jobs.status, [...OPEN]), kind))
    .limit(1)
  return Boolean(row)
}

/**
 * Set the services a Pro offers: adds the new ones, drops the rest unless the
 * Pro still has open jobs in them. Returns the labels of any it had to keep
 * (nothing is changed in that case).
 */
export async function setProServices(tx: Tx, userId: string, wanted: ProServiceRole[]): Promise<string[]> {
  const held = await tx.select({ role: userRoles.role }).from(userRoles).where(eq(userRoles.userId, userId))
  const drop = PRO_SERVICE_ROLES.filter((r) => !wanted.includes(r) && held.some((h) => h.role === r))
  const kept: string[] = []
  for (const r of drop) if (await hasOpenJobs(tx, userId, r)) kept.push(PRO_SERVICES.find((s) => s.role === r)!.label.toLowerCase())
  if (kept.length) return kept
  if (wanted.length) {
    await tx.insert(userRoles).values(wanted.map((role) => ({ userId, role }))).onConflictDoNothing()
  }
  if (drop.length) {
    await tx.delete(userRoles).where(and(eq(userRoles.userId, userId), inArray(userRoles.role, drop)))
  }
  return []
}
