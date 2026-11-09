import { and, inArray, lt, sql } from 'drizzle-orm'
import { errorResponse, ok, unauthorized } from '@/lib/api'
import { invoices, withServiceRole } from '@/db'
import { logAuditEvent } from '@/lib/audit'
import { verifyCronAuth, verifyExternalApiKey } from '@/lib/webhooks'

export const maxDuration = 60
export const runtime = 'nodejs'

/**
 * GET /api/cron/mark-overdue — Phase 5 of the inbuilt invoice generator.
 *
 * Any invoice in status `issued` or `sent` whose `due_date` is strictly
 * before today (UTC) is flipped to `overdue`. The status surfaces in the
 * admin/client/worker lists with a destructive badge and unlocks the
 * "Outstanding" highlight on the recipient detail view.
 *
 * Idempotent — invoices already in `overdue`, `paid`, `void`, or `draft`
 * are untouched. A no-op day produces no audit rows. Each flipped invoice
 * audits with `actorUserId: null` + `payload.actor = 'cron'` to keep the
 * lifecycle trail consistent with the admin-driven transitions.
 *
 * Vercel Cron schedule: daily at 06:30 UTC (vercel.json) — 30 minutes
 * after the doc-expiry sweep so a stuck migration doesn't break both.
 */
export async function GET(req: Request) {
  if (!verifyCronAuth(req) && !verifyExternalApiKey(req)) {
    return unauthorized()
  }

  try {
    const todayIso = new Date().toISOString().slice(0, 10)

    const flipped = await withServiceRole(async (tx) => {
      const rows = await tx
        .update(invoices)
        .set({ status: 'overdue', updatedAt: sql`now()` })
        .where(
          and(
            inArray(invoices.status, ['issued', 'sent']),
            lt(invoices.dueDate, todayIso)
          )
        )
        .returning({
          id: invoices.id,
          reference: invoices.reference,
          dueDate: invoices.dueDate,
          total: invoices.total,
          paidTotal: invoices.paidTotal,
          clientId: invoices.clientId,
        })

      for (const r of rows) {
        await logAuditEvent(tx, {
          category: 'billing',
          action: 'invoice.overdue',
          actorUserId: null,
          targetType: 'invoice',
          targetId: r.id,
          payload: {
            actor: 'cron',
            reference: r.reference,
            dueDate: r.dueDate,
            total: r.total,
            paidTotal: r.paidTotal,
            clientId: r.clientId,
          },
        })
      }
      return rows
    })

    return ok({
      success: true,
      flippedCount: flipped.length,
      flipped: flipped.map((r) => ({ id: r.id, reference: r.reference })),
    })
  } catch (err) {
    console.error('[cron/mark-overdue] error:', err)
    return errorResponse(err)
  }
}
