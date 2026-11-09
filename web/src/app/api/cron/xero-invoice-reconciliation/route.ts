import { and, eq, gte, inArray, sql } from 'drizzle-orm'
import { errorResponse, ok, unauthorized } from '@/lib/api'
import {
  jobs,
  notifications,
  userRoles,
  withServiceRole,
  xeroConnections,
} from '@/db'
import {
  XERO_API_BASE,
  getValidXeroAccess,
  xeroHeaders,
} from '@/lib/xero'
import {
  verifyCronAuth,
  verifyExternalApiKey,
} from '@/lib/webhooks'

export const maxDuration = 60
export const runtime = 'nodejs'

/**
 * GET /api/cron/xero-invoice-reconciliation
 *
 * M2 #5 — daily drift check between LISTD jobs and Xero invoices. For every
 * connected Xero tenant, list LISTD-prefixed invoices and cross-check against
 * jobs that should have an invoice but don't.
 *
 * Job is "should be invoiced" when:
 *   - status ∈ {completed, paid, signed}
 *   - delivered_at within the last 90 days (older drift is unlikely fixable
 *     by an automated alert)
 *
 * On drift, an in-app notification is inserted for every admin (idempotent
 * per (admin, job) per day). The notification points at /admin/jobs/[id]
 * for triage.
 *
 * Vercel Cron schedule: daily at 07:00 UTC.
 *
 * **Scope notes:**
 *   - Reconciliation is per Xero connection (per user). A user with multiple
 *     tenants gets the most-recently-connected one (matches the regular
 *     invoice handler in [/api/xero/invoices](../../xero/invoices/route.ts)).
 *   - We don't auto-create the missing invoices — that's a deliberate
 *     decision; the drift alert routes the admin to the manual create flow.
 *   - The `LISTD-` prefix discovery uses `Reference.StartsWith` so we
 *     paginate through up to 200 invoices per tenant; tighter pagination is
 *     a follow-up if a tenant ever has more.
 */
export async function GET(req: Request) {
  if (!verifyCronAuth(req) && !verifyExternalApiKey(req)) {
    return unauthorized()
  }

  try {
    const todayStart = sql`date_trunc('day', now())`
    const cutoff90DaysISO = new Date(
      Date.now() - 90 * 24 * 60 * 60 * 1000
    ).toISOString()

    // 1) Gather distinct connected user_ids (one user → one tenant).
    const connections = await withServiceRole(async (tx) => {
      const rows = await tx
        .selectDistinct({ userId: xeroConnections.userId })
        .from(xeroConnections)
      return rows.map((r) => r.userId)
    })

    if (connections.length === 0) {
      return ok({ message: 'No Xero connections', missing: 0 })
    }

    // 2) Resolve admins for the alert payload (one query, not per-iteration).
    const admins = await withServiceRole(async (tx) =>
      tx
        .select({ userId: userRoles.userId })
        .from(userRoles)
        .where(eq(userRoles.role, 'admin'))
    )

    let totalDrift = 0
    const driftReport: Array<{
      userId: string
      jobId: string
      reference: string
    }> = []

    for (const userId of connections) {
      // 3) Get a fresh access token. Skip this connection on refresh failure
      // — the user will need to reconnect, but we don't want the cron to
      // 502 the whole batch over one bad token.
      let access
      try {
        access = await getValidXeroAccess(userId)
      } catch (err) {
        console.warn(
          `[cron/xero-recon] skipping userId=${userId} : token refresh failed:`,
          err
        )
        continue
      }

      // 4) Pull every LISTD-prefixed invoice from this tenant.
      const xeroReferences = await fetchListdInvoiceReferences(access)

      // 5) Pull this user's jobs that should be invoiced.
      const userJobs = await withServiceRole(async (tx) =>
        tx
          .select({ id: jobs.id, status: jobs.status, deliveredAt: jobs.deliveredAt })
          .from(jobs)
          .where(
            and(
              eq(jobs.clientId, userId),
              inArray(jobs.status, ['completed', 'paid', 'signed']),
              gte(jobs.deliveredAt, cutoff90DaysISO)
            )
          )
      )

      // 6) Drift detection — jobs without a matching reference in Xero.
      const missing: Array<{ id: string; reference: string }> = []
      for (const job of userJobs) {
        const expectedRef = `LISTD-${job.id.substring(0, 8).toUpperCase()}`
        if (!xeroReferences.has(expectedRef)) {
          missing.push({ id: job.id, reference: expectedRef })
        }
      }

      if (missing.length === 0) continue
      totalDrift += missing.length
      for (const m of missing) {
        driftReport.push({ userId, jobId: m.id, reference: m.reference })
      }

      // 7) Notify admins. Idempotent: same-day dedupe on (admin, job_id link).
      // Pattern matches /api/cron/clerk-doc-expiry's approach.
      if (admins.length > 0 && missing.length > 0) {
        await withServiceRole(async (tx) => {
          const existingToday = await tx.execute(sql`
            select user_id, link from ${notifications}
            where type = 'xero_invoice_drift'
              and created_at >= ${todayStart}
          `)
          const seen = new Set(
            (existingToday as unknown as Array<{ user_id: string; link: string }>).map(
              (r) => `${r.user_id}:${r.link}`
            )
          )

          const fresh: Array<typeof notifications.$inferInsert> = []
          for (const adminRow of admins) {
            for (const m of missing) {
              const link = `/admin/jobs/${m.id}`
              const key = `${adminRow.userId}:${link}`
              if (seen.has(key)) continue
              seen.add(key)
              fresh.push({
                userId: adminRow.userId,
                type: 'xero_invoice_drift',
                title: 'Job missing Xero invoice',
                message: `Job ${m.reference} is marked completed/paid but has no matching Xero invoice for the connected tenant.`,
                link,
              })
            }
          }
          if (fresh.length > 0) {
            await tx.insert(notifications).values(fresh)
          }
        })
      }
    }

    return ok({
      success: true,
      tenantsChecked: connections.length,
      driftCount: totalDrift,
      drift: driftReport.slice(0, 50), // truncate for log readability
    })
  } catch (err) {
    console.error('[cron/xero-invoice-reconciliation] error:', err)
    return errorResponse(err)
  }
}

/**
 * Pull every Xero invoice with `Reference` starting `LISTD-` from the given
 * tenant. Paginated (Xero returns up to 100 per page; we walk up to 2 pages
 * = 200 invoices, which is plenty for the 90-day reconciliation window).
 *
 * Returns a Set<string> of references for fast membership tests.
 */
async function fetchListdInvoiceReferences(access: {
  accessToken: string
  tenantId: string
}): Promise<Set<string>> {
  const refs = new Set<string>()
  const where = encodeURIComponent('Reference!=null')
  for (let page = 1; page <= 2; page++) {
    const url = `${XERO_API_BASE}/Invoices?page=${page}&where=${where}`
    const res = await fetch(url, { headers: xeroHeaders(access) })
    if (!res.ok) {
      const txt = await res.text().catch(() => '<unreadable>')
      console.error(
        `[cron/xero-recon] Xero list invoices failed page=${page}:`,
        res.status,
        txt.slice(0, 200)
      )
      break
    }
    const json = (await res.json()) as {
      Invoices?: Array<{ Reference?: string | null }>
    }
    const page_invoices = json.Invoices ?? []
    for (const inv of page_invoices) {
      if (inv.Reference?.startsWith('LISTD-')) {
        refs.add(inv.Reference)
      }
    }
    if (page_invoices.length < 100) break // last page
  }
  return refs
}
