import { and, eq, inArray, isNotNull, lt, sql } from 'drizzle-orm'
import { errorResponse, ok, unauthorized } from '@/lib/api'
import {
  emailLogs,
  jobs,
  notifications,
  profiles,
  reportShareTokens,
  smsLogs,
  tenantTokens,
  withServiceRole,
} from '@/db'
import { logAuditEvent } from '@/lib/audit'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { parseSupabaseStorageUrl } from '@/lib/storage/download'
import { verifyCronAuth, verifyExternalApiKey } from '@/lib/webhooks'

export const maxDuration = 60
export const runtime = 'nodejs'

/**
 * GET /api/cron/data-retention — daily GDPR retention sweep. Purges personal
 * data past its retention window per category. Conservative defaults; tune the
 * constants (or later move to platform_settings).
 *
 * Idempotent: each category deletes only rows/objects past its cutoff, and the
 * photo sweep uses an audit marker so a job's photos are purged at most once.
 * Vercel Cron: daily at 02:30 UTC (vercel.json).
 */

// Retention windows (days).
const VETTING_GRACE_DAYS = 30 // delete DBS / ID / insurance this long after expiry
const COMMS_LOG_DAYS = 365 // email + SMS delivery logs
const NOTIFICATION_DAYS = 180 // read notifications
const PHOTO_RETENTION_DAYS = 365 // inspection photos after a job is delivered
const PHOTO_JOB_BATCH = 100 // jobs processed per run (drains forward)

const REVENUE_DONE = ['completed', 'paid', 'signed'] as const

export async function GET(req: Request) {
  if (!verifyCronAuth(req) && !verifyExternalApiKey(req)) {
    return unauthorized()
  }

  try {
    const now = Date.now()
    const isoDaysAgo = (d: number) => new Date(now - d * 86_400_000).toISOString()
    const dateDaysAgo = (d: number) =>
      new Date(now - d * 86_400_000).toISOString().slice(0, 10)
    const admin = getSupabaseAdmin()
    const summary: Record<string, number> = {}

    // ── 1. Expired vetting documents (DBS / gov ID / insurance) ──────────────
    // Keep ID/criminal-record data no longer than needed: purge the document
    // (storage + the column) once it's expired beyond the grace period.
    const graceDate = dateDaysAgo(VETTING_GRACE_DAYS)

    // DBS certificate (storage object).
    const dbsRows = await withServiceRole((tx) =>
      tx
        .select({ url: profiles.dbsCertificateUrl })
        .from(profiles)
        .where(
          and(
            isNotNull(profiles.dbsExpiry),
            lt(profiles.dbsExpiry, graceDate),
            isNotNull(profiles.dbsCertificateUrl)
          )
        )
    )
    await removeStorage(admin, dbsRows.map((r) => r.url))
    if (dbsRows.length) {
      await withServiceRole((tx) =>
        tx
          .update(profiles)
          .set({ dbsCertificateUrl: null, updatedAt: sql`now()` })
          .where(
            and(isNotNull(profiles.dbsExpiry), lt(profiles.dbsExpiry, graceDate))
          )
      )
    }
    summary.dbsDocs = dbsRows.length

    // Government ID (storage object).
    const idRows = await withServiceRole((tx) =>
      tx
        .select({ url: profiles.governmentIdUrl })
        .from(profiles)
        .where(
          and(
            isNotNull(profiles.governmentIdExpiry),
            lt(profiles.governmentIdExpiry, graceDate),
            isNotNull(profiles.governmentIdUrl)
          )
        )
    )
    await removeStorage(admin, idRows.map((r) => r.url))
    if (idRows.length) {
      await withServiceRole((tx) =>
        tx
          .update(profiles)
          .set({ governmentIdUrl: null, updatedAt: sql`now()` })
          .where(
            and(
              isNotNull(profiles.governmentIdExpiry),
              lt(profiles.governmentIdExpiry, graceDate)
            )
          )
      )
    }
    summary.governmentIdDocs = idRows.length

    // Insurance details (free-text, no storage object).
    const ins = await withServiceRole((tx) =>
      tx
        .update(profiles)
        .set({ insuranceDetails: null, updatedAt: sql`now()` })
        .where(
          and(
            isNotNull(profiles.insuranceExpiry),
            lt(profiles.insuranceExpiry, graceDate),
            isNotNull(profiles.insuranceDetails)
          )
        )
        .returning({ id: profiles.id })
    )
    summary.insuranceDetails = ins.length

    // ── 2. Old comms logs ────────────────────────────────────────────────────
    const el = await withServiceRole((tx) =>
      tx
        .delete(emailLogs)
        .where(lt(emailLogs.createdAt, isoDaysAgo(COMMS_LOG_DAYS)))
        .returning({ id: emailLogs.id })
    )
    summary.emailLogs = el.length
    const sl = await withServiceRole((tx) =>
      tx
        .delete(smsLogs)
        .where(lt(smsLogs.createdAt, isoDaysAgo(COMMS_LOG_DAYS)))
        .returning({ id: smsLogs.id })
    )
    summary.smsLogs = sl.length

    // ── 3. Old read notifications ────────────────────────────────────────────
    const nt = await withServiceRole((tx) =>
      tx
        .delete(notifications)
        .where(
          and(
            eq(notifications.read, true),
            lt(notifications.createdAt, isoDaysAgo(NOTIFICATION_DAYS))
          )
        )
        .returning({ id: notifications.id })
    )
    summary.notifications = nt.length

    // ── 4. Expired access tokens ─────────────────────────────────────────────
    const tt = await withServiceRole((tx) =>
      tx
        .delete(tenantTokens)
        .where(lt(tenantTokens.expiresAt, new Date(now).toISOString()))
        .returning({ id: tenantTokens.id })
    )
    summary.tenantTokens = tt.length
    const rst = await withServiceRole((tx) =>
      tx
        .delete(reportShareTokens)
        .where(lt(reportShareTokens.expiresAt, new Date(now).toISOString()))
        .returning({ id: reportShareTokens.id })
    )
    summary.reportShareTokens = rst.length

    // ── 5. Inspection photos for long-delivered jobs ─────────────────────────
    // Bounded batch; an audit marker ensures each job is purged at most once.
    const photoJobs = await withServiceRole((tx) =>
      tx
        .select({ id: jobs.id })
        .from(jobs)
        .where(
          and(
            inArray(jobs.status, [...REVENUE_DONE]),
            isNotNull(jobs.deliveredAt),
            lt(jobs.deliveredAt, isoDaysAgo(PHOTO_RETENTION_DAYS)),
            sql`NOT EXISTS (SELECT 1 FROM audit_events ae WHERE ae.target_id = ${jobs.id}::text AND ae.action = 'retention.photos_purged')`
          )
        )
        .limit(PHOTO_JOB_BATCH)
    )
    let photosPurged = 0
    for (const j of photoJobs) {
      try {
        const { data: list } = await admin.storage.from('job-photos').list(j.id)
        const paths = (list ?? []).map((o) => `${j.id}/${o.name}`)
        if (paths.length) {
          await admin.storage.from('job-photos').remove(paths)
          photosPurged += paths.length
        }
        await withServiceRole((tx) =>
          logAuditEvent(tx, {
            category: 'job_lifecycle',
            action: 'retention.photos_purged',
            actorUserId: null,
            targetType: 'job',
            targetId: j.id,
            payload: { actor: 'cron', objects: paths.length },
          })
        )
      } catch (err) {
        console.warn('[cron/data-retention] photo purge failed for', j.id, err)
      }
    }
    summary.photoJobsProcessed = photoJobs.length
    summary.photosDeleted = photosPurged

    return ok({ ranAt: new Date(now).toISOString(), summary })
  } catch (err) {
    console.error('[cron/data-retention] error:', err)
    return errorResponse(err)
  }
}

/** Parse stored URLs → {bucket,path} and delete the objects, grouped per bucket. */
async function removeStorage(
  admin: ReturnType<typeof getSupabaseAdmin>,
  urls: Array<string | null>
): Promise<void> {
  const byBucket = new Map<string, string[]>()
  for (const url of urls) {
    const parsed = url ? parseSupabaseStorageUrl(url) : null
    if (parsed) {
      byBucket.set(parsed.bucket, [
        ...(byBucket.get(parsed.bucket) ?? []),
        parsed.path,
      ])
    }
  }
  for (const [bucket, paths] of byBucket) {
    try {
      await admin.storage.from(bucket).remove(paths)
    } catch (err) {
      console.warn('[cron/data-retention] remove failed', bucket, err)
    }
  }
}
