import 'server-only'
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { jobMessages, jobs, notifications, profiles, userRoles, withServiceRole, type Tx } from '@/db'
import { canActOnClientJob } from './client-access'
import { proJobPath } from './job-approval'
import { getProWorkflow } from './pro-workflow'

/**
 * Job conversations. Two channels, both with LISTD in the middle:
 *   'pro'     the assigned Pro and LISTD
 *   'client'  the client and LISTD (only when Admin › Settings switches it on)
 * There is no Pro-to-client channel: LISTD relays anything either side needs.
 */

export type Channel = 'pro' | 'client'
export type ThreadMessage = {
  id: string
  side: 'listd' | 'pro' | 'client' | 'system'
  senderName: string | null
  body: string
  createdAt: string
}

type Session = { userId: string; roles: readonly string[] }
const ref = (id: string) => id.slice(0, 8)

/** Which channel this user may use on this job, or null. Admins may use either. */
export async function channelAccess(tx: Tx, s: Session, jobId: string, channel: Channel): Promise<'listd' | 'pro' | 'client' | null> {
  if (s.roles.includes('admin')) return 'listd'
  const [job] = await tx.select({ clerkId: jobs.clerkId, cleanerId: jobs.cleanerId }).from(jobs).where(eq(jobs.id, jobId)).limit(1)
  if (!job) return null
  if (channel === 'pro') return job.clerkId === s.userId || job.cleanerId === s.userId ? 'pro' : null
  if (!(await getProWorkflow()).clientChat) return null
  return (await canActOnClientJob(tx, s as never, jobId)) ? 'client' : null
}

export async function loadThread(jobId: string, channel: Channel, viewerSide: 'listd' | 'pro' | 'client'): Promise<ThreadMessage[]> {
  return withServiceRole(async (tx) => {
    const rows = await tx
      .select({
        id: jobMessages.id,
        side: jobMessages.senderSide,
        body: jobMessages.body,
        createdAt: jobMessages.createdAt,
        senderName: profiles.fullName,
      })
      .from(jobMessages)
      .leftJoin(profiles, eq(profiles.userId, jobMessages.senderId))
      .where(and(eq(jobMessages.jobId, jobId), eq(jobMessages.channel, channel)))
      .orderBy(asc(jobMessages.createdAt))
    // Opening the thread marks the other side's messages read.
    if (viewerSide === 'listd') {
      await tx
        .update(jobMessages)
        .set({ readByListdAt: sql`now()` })
        .where(and(eq(jobMessages.jobId, jobId), eq(jobMessages.channel, channel), isNull(jobMessages.readByListdAt), inArray(jobMessages.senderSide, ['pro', 'client'])))
    } else {
      await tx
        .update(jobMessages)
        .set({ readByPartyAt: sql`now()` })
        .where(and(eq(jobMessages.jobId, jobId), eq(jobMessages.channel, channel), isNull(jobMessages.readByPartyAt), inArray(jobMessages.senderSide, ['listd', 'system'])))
    }
    return rows.map((r) => ({
      id: r.id,
      side: r.side as ThreadMessage['side'],
      // Pros and clients see "LISTD", never which admin wrote.
      senderName: r.side === 'listd' ? (viewerSide === 'listd' ? r.senderName : 'LISTD') : r.side === 'system' ? 'LISTD' : r.senderName,
      body: r.body,
      createdAt: r.createdAt,
    }))
  })
}

export async function postMessage(tx: Tx, p: { jobId: string; channel: Channel; senderId: string; side: 'listd' | 'pro' | 'client'; body: string }) {
  const [row] = await tx
    .insert(jobMessages)
    .values({ jobId: p.jobId, channel: p.channel, senderId: p.senderId, senderSide: p.side, body: p.body })
    .returning({ id: jobMessages.id })
  const [job] = await tx
    .select({ clerkId: jobs.clerkId, cleanerId: jobs.cleanerId, clientId: jobs.clientId, inspectionType: jobs.inspectionType })
    .from(jobs)
    .where(eq(jobs.id, p.jobId))
    .limit(1)
  const preview = p.body.length > 140 ? `${p.body.slice(0, 137)}...` : p.body
  if (p.side === 'listd') {
    const to = p.channel === 'pro' ? (job?.clerkId ?? job?.cleanerId) : job?.clientId
    if (to) {
      await tx.insert(notifications).values({
        userId: to,
        type: 'message',
        title: `LISTD replied on job ${ref(p.jobId)}`,
        message: preview,
        link: p.channel === 'pro' && job ? proJobPath(job.inspectionType, p.jobId) : `/client/jobs/${p.jobId}`,
      })
    }
  } else {
    const admins = await tx.select({ userId: userRoles.userId }).from(userRoles).where(eq(userRoles.role, 'admin'))
    if (admins.length) {
      await tx.insert(notifications).values(
        [...new Set(admins.map((a) => a.userId))].map((userId) => ({
          userId,
          type: 'message',
          title: `${p.side === 'pro' ? 'Pro' : 'Client'} message on job ${ref(p.jobId)}`,
          message: preview,
          link: `/admin/jobs/${p.jobId}`,
        }))
      )
    }
  }
  return row.id
}

/** Admin inbox: latest message per job and channel, unanswered first. */
export async function loadAdminInbox(limit = 100) {
  return withServiceRole(async (tx) => {
    const rows = await tx.execute(sql`
      select distinct on (m.job_id, m.channel)
             m.job_id, m.channel, m.sender_side, m.body, m.created_at,
             (select count(*)::int from job_messages u
               where u.job_id = m.job_id and u.channel = m.channel
                 and u.read_by_listd_at is null and u.sender_side in ('pro', 'client')) as unread,
             j.inspection_type, p.full_name as sender_name
        from job_messages m
        join jobs j on j.id = m.job_id
        left join profiles p on p.user_id = m.sender_id
       where m.sender_side <> 'system'
       order by m.job_id, m.channel, m.created_at desc
    `)
    const list = (rows as unknown as Array<{
      job_id: string
      channel: Channel
      sender_side: string
      body: string
      created_at: string
      unread: number
      inspection_type: string
      sender_name: string | null
    }>).map((r) => ({
      jobId: r.job_id,
      channel: r.channel,
      lastSide: r.sender_side,
      body: r.body,
      createdAt: String(r.created_at),
      unread: r.unread,
      inspectionType: r.inspection_type,
      senderName: r.sender_name,
    }))
    list.sort((a, b) => b.unread - a.unread || (a.createdAt < b.createdAt ? 1 : -1))
    return list.slice(0, limit)
  })
}

export async function unreadForListd(): Promise<number> {
  const [r] = await withServiceRole((tx) =>
    tx
      .select({ n: sql<number>`count(*)::int` })
      .from(jobMessages)
      .where(and(isNull(jobMessages.readByListdAt), inArray(jobMessages.senderSide, ['pro', 'client'])))
  )
  return r?.n ?? 0
}

