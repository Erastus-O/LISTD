import { and, eq, gt, isNull, lt, ne, notInArray, sql } from 'drizzle-orm'
import { errorResponse, escapeHtml, ok, unauthorized } from '@/lib/api'
import { invoices, jobs, notifications, withServiceRole } from '@/db'
import { logAuditEvent } from '@/lib/audit'
import { verifyCronAuth, verifyExternalApiKey } from '@/lib/webhooks'
import { getBillingProvider } from '@/lib/billing/select'
import type { InvoiceLineItemDraft } from '@/lib/billing/provider'
import {
  cleaningLabelFromType,
  isCleaningType,
  serviceLabel,
} from '@/lib/pricing-matrix'
import { getEffectivePricing } from '@/lib/pricing-settings'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { FROM_TRANSACTIONAL, getResend, logEmail } from '@/lib/resend'

export const maxDuration = 60
export const runtime = 'nodejs'

/** System actor for provider calls made by the cron (no logged-in user). */
const SYSTEM_ACTOR = '00000000-0000-0000-0000-000000000000'

/** Days after issue before the consolidated invoice falls due. */
const DUE_IN_DAYS = 14

/** Minimum days between payment reminders for the same invoice. */
const REMINDER_EVERY_DAYS = 3

/**
 * GET /api/cron/monthly-promo-billing — the settlement engine for
 * invoice-later promo codes (0035). Runs DAILY; both passes are idempotent:
 *
 *  1. MONTH-END SWEEP — invoice-later jobs from months that have ENDED
 *     (created before the 1st of the current month, not cancelled, not yet
 *     invoiced) are consolidated into ONE invoice per client:
 *     create → link jobs (jobs.invoice_id = the idempotency marker, same as
 *     escrow receipts) → issue → mint a Stripe payment link → notify the
 *     client in-app + email. Payment lands through the existing
 *     checkout.session.completed webhook → provider.recordPayment.
 *
 *  2. REMINDERS — issued-but-unpaid promo invoices get a nudge (fresh
 *     payment link — Checkout sessions expire after 24h) every
 *     REMINDER_EVERY_DAYS, in-app + email, until paid or voided.
 *
 * Clerk/cleaner pay for these jobs is surfaced as "due at month end" on
 * their dashboards (loadWorkerMonthEndDue) and settled by admin in the
 * monthly run — no escrow was taken, so QA release has nothing to transfer.
 */
export async function GET(req: Request) {
  if (!verifyCronAuth(req) && !verifyExternalApiKey(req)) {
    return unauthorized()
  }

  try {
    const now = new Date()
    const monthStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
    ).toISOString()

    const [swept, reminded] = [
      await sweepMonthEnd(monthStart),
      await sendReminders(),
    ]

    return ok({ success: true, ...swept, ...reminded })
  } catch (err) {
    console.error('[cron/monthly-promo-billing] error:', err)
    return errorResponse(err)
  }
}

/** Pass 1: one consolidated invoice per client for last month's jobs. */
async function sweepMonthEnd(monthStartIso: string) {
  const due = await withServiceRole((tx) =>
    tx
      .select({
        id: jobs.id,
        clientId: jobs.clientId,
        organisationId: jobs.organisationId,
        inspectionType: jobs.inspectionType,
        scheduledDate: jobs.scheduledDate,
        quotedPrice: jobs.quotedPrice,
        jobRefNumber: jobs.jobRefNumber,
      })
      .from(jobs)
      .where(
        and(
          eq(jobs.promoKind, 'invoice_later'),
          isNull(jobs.invoiceId),
          notInArray(jobs.status, ['cancelled']),
          lt(jobs.createdAt, monthStartIso)
        )
      )
  ).catch(() => [])

  if (due.length === 0) return { invoicedClients: 0, invoicedJobs: 0 }

  const pricing = await getEffectivePricing().catch(() => null)
  const label = (type: string) =>
    (pricing && isCleaningType(type)
      ? cleaningLabelFromType(type, pricing.cleaning)
      : null) ?? serviceLabel(type, pricing?.customTypes ?? [])

  const byClient = new Map<string, typeof due>()
  for (const j of due) {
    const list = byClient.get(j.clientId) ?? []
    list.push(j)
    byClient.set(j.clientId, list)
  }

  const provider = await getBillingProvider()
  const monthName = new Date(
    new Date(monthStartIso).getTime() - 86400000
  ).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })

  let invoicedClients = 0
  let invoicedJobs = 0
  const failures: Array<{ clientId: string; error: string }> = []

  for (const [clientId, clientJobs] of byClient) {
    try {
      const lineItems: InvoiceLineItemDraft[] = clientJobs.map((j, i) => ({
        description: `${label(j.inspectionType)} — #${j.jobRefNumber} (${j.scheduledDate})`,
        quantity: 1,
        unitPrice: Number(j.quotedPrice ?? 0),
        jobId: j.id,
        position: i + 1,
      }))
      const total = lineItems.reduce((s, l) => s + l.unitPrice, 0)

      const draft = await provider.createInvoice(
        {
          clientId,
          organisationId: clientJobs[0].organisationId ?? null,
          notes: `Monthly account — promo bookings for ${monthName}. Settles all jobs posted on your monthly-account promo code.`,
          dueInDays: DUE_IN_DAYS,
          lineItems,
        },
        SYSTEM_ACTOR
      )

      // Link the jobs FIRST — this is the idempotency marker. If anything
      // after this fails the invoice may sit in draft (fix from
      // /admin/invoices), but the jobs can never be double-billed.
      await withServiceRole(async (tx) => {
        for (const j of clientJobs) {
          await tx
            .update(jobs)
            .set({ invoiceId: draft.id })
            .where(eq(jobs.id, j.id))
        }
        await logAuditEvent(tx, {
          category: 'billing',
          action: 'promo.month_end_invoiced',
          actorUserId: null,
          targetType: 'invoice',
          targetId: draft.id,
          payload: {
            actor: 'cron',
            clientId,
            jobIds: clientJobs.map((j) => j.id),
            total,
            month: monthName,
          },
        })
      })

      const issued = await provider.issueInvoice(draft.id, SYSTEM_ACTOR)

      // Payment link + delivery are best-effort — the reminder pass mints a
      // fresh link on its next run if this one fails or expires.
      let checkoutUrl: string | null = null
      if (typeof provider.createPaymentLink === 'function') {
        try {
          const link = await provider.createPaymentLink(draft.id, SYSTEM_ACTOR)
          checkoutUrl = link.checkoutUrl
        } catch (err) {
          console.warn(
            '[cron/monthly-promo-billing] payment link failed:',
            draft.id,
            err
          )
        }
      }

      await deliverPromoInvoice({
        clientId,
        invoiceId: draft.id,
        reference: issued.reference,
        totalPounds: total,
        monthName,
        checkoutUrl,
        reminder: false,
      })

      invoicedClients += 1
      invoicedJobs += clientJobs.length
    } catch (err) {
      console.error(
        '[cron/monthly-promo-billing] sweep failed for client:',
        clientId,
        err
      )
      failures.push({
        clientId,
        error: err instanceof Error ? err.message : 'Unknown error',
      })
    }
  }

  return { invoicedClients, invoicedJobs, sweepFailures: failures }
}

/** Pass 2: nudge unpaid promo invoices every REMINDER_EVERY_DAYS. */
async function sendReminders() {
  // Promo invoices = invoices that invoice-later jobs point at. Unpaid =
  // issued (or overdue) with paid_total < total, not void.
  const unpaid = await withServiceRole((tx) =>
    tx
      .select({
        id: invoices.id,
        clientId: invoices.clientId,
        reference: invoices.reference,
        total: invoices.total,
        paidTotal: invoices.paidTotal,
        dueDate: invoices.dueDate,
        issuedAt: invoices.issuedAt,
      })
      .from(invoices)
      .where(
        and(
          notInArray(invoices.status, ['draft', 'paid', 'void']),
          gt(sql`${invoices.total}::numeric`, sql`${invoices.paidTotal}::numeric`),
          ne(invoices.kind, 'credit_note'),
          sql`EXISTS (
            SELECT 1 FROM jobs j
            WHERE j.invoice_id = ${invoices.id}
              AND j.promo_kind = 'invoice_later'
          )`
        )
      )
  ).catch(() => [])

  let sent = 0
  for (const inv of unpaid) {
    try {
      // Give the client REMINDER_EVERY_DAYS to act on the initial email, and
      // the same gap between nudges (tracked via the reminder notifications
      // this cron itself writes).
      const issuedAgoMs = inv.issuedAt
        ? Date.now() - new Date(inv.issuedAt).getTime()
        : 0
      if (issuedAgoMs < REMINDER_EVERY_DAYS * 86400000) continue

      const cutoff = new Date(
        Date.now() - REMINDER_EVERY_DAYS * 86400000
      ).toISOString()
      const recent = await withServiceRole((tx) =>
        tx
          .select({ id: notifications.id })
          .from(notifications)
          .where(
            and(
              eq(notifications.userId, inv.clientId),
              eq(notifications.type, 'payment_reminder'),
              sql`${notifications.message} LIKE ${'%' + (inv.reference ?? inv.id) + '%'}`,
              gt(notifications.createdAt, cutoff)
            )
          )
          .limit(1)
      )
      if (recent.length > 0) continue

      // Fresh payment link every reminder — Checkout sessions expire.
      const provider = await getBillingProvider()
      let checkoutUrl: string | null = null
      if (typeof provider.createPaymentLink === 'function') {
        try {
          const link = await provider.createPaymentLink(inv.id, SYSTEM_ACTOR)
          checkoutUrl = link.checkoutUrl
        } catch (err) {
          console.warn(
            '[cron/monthly-promo-billing] reminder link failed:',
            inv.id,
            err
          )
        }
      }

      const outstanding = Number(inv.total) - Number(inv.paidTotal)
      await deliverPromoInvoice({
        clientId: inv.clientId,
        invoiceId: inv.id,
        reference: inv.reference,
        totalPounds: outstanding,
        monthName: null,
        checkoutUrl,
        reminder: true,
        dueDate: inv.dueDate,
      })
      sent += 1
    } catch (err) {
      console.warn(
        '[cron/monthly-promo-billing] reminder failed:',
        inv.id,
        err
      )
    }
  }

  return { remindersSent: sent, unpaidPromoInvoices: unpaid.length }
}

/**
 * In-app + email delivery for a monthly-account invoice or its reminder.
 * Billing documents are transactional — sent regardless of marketing
 * notification preferences. Best-effort: never throws.
 */
async function deliverPromoInvoice(p: {
  clientId: string
  invoiceId: string
  reference: string | null
  totalPounds: number
  monthName: string | null
  checkoutUrl: string | null
  reminder: boolean
  dueDate?: string | null
}) {
  const ref = p.reference ?? p.invoiceId.slice(0, 8)
  const amount = `£${p.totalPounds.toFixed(2)}`
  const title = p.reminder
    ? 'Payment reminder — monthly account'
    : 'Your monthly account invoice is ready'
  const message = p.reminder
    ? `Invoice ${ref} (${amount}) is still outstanding${p.dueDate ? `, due ${p.dueDate}` : ''}. Pay securely via the link.`
    : `Invoice ${ref} for ${amount}${p.monthName ? ` covers your promo bookings for ${p.monthName}` : ''}. Pay securely via the link.`

  try {
    await withServiceRole((tx) =>
      tx.insert(notifications).values({
        userId: p.clientId,
        type: p.reminder ? 'payment_reminder' : 'payment',
        title,
        message,
        link: p.checkoutUrl ?? '/client/statement',
      })
    )
  } catch (err) {
    console.warn('[cron/monthly-promo-billing] in-app notify failed:', err)
  }

  try {
    const admin = getSupabaseAdmin()
    const u = await admin.auth.admin.getUserById(p.clientId)
    const email = u.data?.user?.email
    if (!email) return
    const subject = p.reminder
      ? `Payment reminder: LISTD invoice ${ref} (${amount})`
      : `Your LISTD monthly account invoice ${ref} (${amount})`
    const html = buildInvoiceEmailHtml({ ...p, ref, amount, title, message })
    const res = await getResend().emails.send({
      from: FROM_TRANSACTIONAL,
      to: [email],
      subject,
      html,
    })
    await logEmail({
      functionName: p.reminder
        ? 'promo-invoice-reminder'
        : 'promo-invoice-issued',
      recipientEmails: [email],
      subject,
      resendId: res.data?.id ?? null,
      errorMessage: res.error?.message ?? null,
      metadata: { invoiceId: p.invoiceId },
    })
  } catch (err) {
    console.warn('[cron/monthly-promo-billing] email failed:', err)
  }
}

function buildInvoiceEmailHtml(p: {
  ref: string
  amount: string
  title: string
  message: string
  checkoutUrl: string | null
  dueDate?: string | null
}): string {
  const payBlock = p.checkoutUrl
    ? `<div style="text-align:center;">
         <a href="${escapeHtml(p.checkoutUrl)}" style="display:inline-block;background:#0d9488;color:#fff;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:600;font-size:16px;">Pay ${escapeHtml(p.amount)} securely</a>
       </div>
       <p style="color:#a1a1aa;font-size:12px;text-align:center;margin-top:24px;">This secure payment link is powered by Stripe.</p>`
    : `<p style="color:#52525b;font-size:14px;">Sign in to LISTD and open your statement to settle this invoice.</p>`
  return `
    <!DOCTYPE html>
    <html><head><meta charset="utf-8"></head>
    <body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;margin:0;padding:0;background:#f4f4f5;">
      <div style="max-width:600px;margin:0 auto;padding:20px;">
        <div style="background:#fff;border-radius:12px;padding:32px;box-shadow:0 1px 3px rgba(0,0,0,.1);">
          <h1 style="color:#18181b;font-size:22px;margin:0 0 16px;">${escapeHtml(p.title)}</h1>
          <p style="color:#52525b;font-size:16px;line-height:1.5;margin:0 0 8px;">${escapeHtml(p.message)}</p>
          ${p.dueDate ? `<p style="color:#52525b;font-size:14px;margin:0 0 24px;">Due date: <strong>${escapeHtml(p.dueDate)}</strong></p>` : '<div style="height:16px;"></div>'}
          ${payBlock}
        </div>
      </div>
    </body></html>
  `.trim()
}
