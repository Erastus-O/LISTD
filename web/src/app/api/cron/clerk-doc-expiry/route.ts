import { and, eq, isNotNull, lte, or, sql } from 'drizzle-orm'
import { errorResponse, ok, unauthorized } from '@/lib/api'
import { notifications, profiles, withServiceRole } from '@/db'
import { logAuditEvent } from '@/lib/audit'
import { verifyCronAuth, verifyExternalApiKey } from '@/lib/webhooks'

export const maxDuration = 60
export const runtime = 'nodejs'

/**
 * GET /api/cron/clerk-doc-expiry — daily DBS / insurance expiry sweep (M1 #9).
 *
 * Two passes:
 *   1. **60-day pre-expiry prompt**: any verified clerk whose DBS or insurance
 *      lapses in ≤ 60 days gets an in-app notification (one per doc, idempotent
 *      per day via the `link` + `created_at` window).
 *   2. **Auto-suspend**: any verified clerk whose DBS or insurance has already
 *      lapsed gets `verification_status` flipped to `suspended` — the
 *      marketplace gate at /clerk/jobs/available picks this up immediately.
 *
 * Vercel Cron schedule: daily at 06:00 UTC (vercel.json).
 */
export async function GET(req: Request) {
  if (!verifyCronAuth(req) && !verifyExternalApiKey(req)) {
    return unauthorized()
  }

  try {
    const todayISO = new Date().toISOString().slice(0, 10)
    const cutoff60ISO = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10)

    const result = await withServiceRole(async (tx) => {
      // ── Pass 1: 60-day pre-expiry prompts ────────────────────────────────
      const expiring = await tx
        .select({
          userId: profiles.userId,
          dbsExpiry: profiles.dbsExpiry,
          insuranceExpiry: profiles.insuranceExpiry,
        })
        .from(profiles)
        .where(
          and(
            eq(profiles.verificationStatus, 'verified'),
            or(
              and(
                isNotNull(profiles.dbsExpiry),
                lte(profiles.dbsExpiry, cutoff60ISO)
              ),
              and(
                isNotNull(profiles.insuranceExpiry),
                lte(profiles.insuranceExpiry, cutoff60ISO)
              )
            )
          )
        )

      const promptValues: Array<{
        userId: string
        type: string
        title: string
        message: string
        link: string
      }> = []

      for (const c of expiring) {
        // Only prompt about docs that haven't already lapsed (those go via
        // the suspend pass below).
        if (
          c.dbsExpiry &&
          c.dbsExpiry > todayISO &&
          c.dbsExpiry <= cutoff60ISO
        ) {
          promptValues.push({
            userId: c.userId,
            type: 'doc_expiry_prompt',
            title: 'Your DBS expires soon',
            message: `Your DBS certificate expires on ${c.dbsExpiry}. Re-upload before then to keep marketplace access.`,
            link: '/onboarding/clerk',
          })
        }
        if (
          c.insuranceExpiry &&
          c.insuranceExpiry > todayISO &&
          c.insuranceExpiry <= cutoff60ISO
        ) {
          promptValues.push({
            userId: c.userId,
            type: 'doc_expiry_prompt',
            title: 'Your insurance expires soon',
            message: `Your professional indemnity insurance expires on ${c.insuranceExpiry}. Re-upload before then to keep marketplace access.`,
            link: '/onboarding/clerk',
          })
        }
      }

      // Idempotency: collapse on (user_id, link, title, day) by relying on
      // notifications.created_at + a "today already" filter rather than a
      // unique index. Adding the index would land in a follow-up migration.
      const todayStart = sql`date_trunc('day', now())`
      let promptsInserted = 0
      if (promptValues.length > 0) {
        const existingToday = await tx.execute(sql`
          select user_id, title from ${notifications}
          where type = 'doc_expiry_prompt'
            and created_at >= ${todayStart}
        `)
        const seen = new Set(
          (existingToday as unknown as Array<{ user_id: string; title: string }>).map(
            (r) => `${r.user_id}:${r.title}`
          )
        )
        const fresh = promptValues.filter(
          (p) => !seen.has(`${p.userId}:${p.title}`)
        )
        if (fresh.length > 0) {
          await tx.insert(notifications).values(fresh)
          promptsInserted = fresh.length
        }
      }

      // ── Pass 2: auto-suspend on lapse ────────────────────────────────────
      const lapsed = await tx
        .update(profiles)
        .set({ verificationStatus: 'suspended' })
        .where(
          and(
            eq(profiles.verificationStatus, 'verified'),
            or(
              and(
                isNotNull(profiles.dbsExpiry),
                lte(profiles.dbsExpiry, todayISO)
              ),
              and(
                isNotNull(profiles.insuranceExpiry),
                lte(profiles.insuranceExpiry, todayISO)
              )
            )
          )
        )
        .returning({
          userId: profiles.userId,
          dbsExpiry: profiles.dbsExpiry,
          insuranceExpiry: profiles.insuranceExpiry,
        })

      if (lapsed.length > 0) {
        await tx.insert(notifications).values(
          lapsed.map((l) => ({
            userId: l.userId,
            type: 'verification_decision',
            title: 'Marketplace access suspended',
            message:
              'A required document on your file has expired. Re-upload an in-date copy to restore access.',
            link: '/onboarding/clerk',
          }))
        )

        // Audit row per suspended user. `actorUserId: null` = cron action.
        for (const l of lapsed) {
          const dbsLapsed = l.dbsExpiry !== null && l.dbsExpiry <= todayISO
          const insLapsed =
            l.insuranceExpiry !== null && l.insuranceExpiry <= todayISO
          await logAuditEvent(tx, {
            category: 'verification',
            action: 'verification.suspended',
            actorUserId: null,
            targetType: 'profile',
            targetId: l.userId,
            payload: {
              actor: 'cron',
              trigger: dbsLapsed && insLapsed
                ? 'dbs_and_insurance_expiry'
                : dbsLapsed
                  ? 'dbs_expiry'
                  : 'insurance_expiry',
              dbsExpiry: l.dbsExpiry,
              insuranceExpiry: l.insuranceExpiry,
            },
          })
        }
      }

      return {
        promptsInserted,
        suspended: lapsed.map((l) => l.userId),
      }
    })

    return ok({
      success: true,
      promptsInserted: result.promptsInserted,
      suspendedCount: result.suspended.length,
      suspended: result.suspended,
    })
  } catch (err) {
    console.error('[cron/clerk-doc-expiry] error:', err)
    return errorResponse(err)
  }
}
