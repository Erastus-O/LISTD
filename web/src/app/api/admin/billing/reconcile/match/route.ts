import { z } from 'zod'
import { errorResponse, ok } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import { getBillingProvider } from '@/lib/billing/select'

export const maxDuration = 60
export const runtime = 'nodejs'

const MatchSchema = z.object({
  invoiceId: z.string().uuid(),
  paidAmount: z.number().positive().max(10_000_000),
  paidAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reference: z.string().trim().max(200).nullable().optional(),
  note: z.string().trim().max(2000).nullable().optional(),
})

const RequestSchema = z
  .object({
    matches: z.array(MatchSchema).min(1).max(200),
  })
  .strict()

/**
 * POST /api/admin/billing/reconcile/match — record the payments the
 * admin has confirmed from the reconciliation table. Each match routes
 * through `provider.recordPayment` with `method: 'bank_transfer'` and
 * the reference set to the bank-statement line text — useful audit
 * trail for "why was this marked paid".
 *
 * Failures per row are isolated: a 500 on one invoice doesn't abort the
 * batch. The response carries per-row outcomes so the page can mark
 * successes and surface failures inline.
 */
export async function POST(req: Request) {
  const session = await authorizeRequest('admin')
  if (session instanceof Response) return session

  try {
    const body = RequestSchema.parse(await req.json())
    const provider = await getBillingProvider()

    const results: Array<{
      invoiceId: string
      ok: boolean
      error: string | null
    }> = []

    for (const m of body.matches) {
      try {
        await provider.recordPayment(m.invoiceId, session.userId, {
          paidAmount: m.paidAmount,
          paidAt: m.paidAt,
          method: 'bank_transfer',
          reference: m.reference ?? null,
          note: m.note ?? 'Reconciled from bank statement',
        })
        results.push({ invoiceId: m.invoiceId, ok: true, error: null })
      } catch (err) {
        results.push({
          invoiceId: m.invoiceId,
          ok: false,
          error: err instanceof Error ? err.message : 'Unknown error',
        })
      }
    }

    return ok({
      processed: results.length,
      successCount: results.filter((r) => r.ok).length,
      results,
    })
  } catch (err) {
    console.error('[admin/billing/reconcile/match] error:', err)
    return errorResponse(err)
  }
}
