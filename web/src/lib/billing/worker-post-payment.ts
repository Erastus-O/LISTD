import 'server-only'
import { and, eq } from 'drizzle-orm'
import {
  notifications,
  organisationMembers,
  organisations,
  withServiceRole,
} from '@/db'
import { escapeHtml } from '@/lib/api'
import { loadUserNotificationPrefs } from '@/lib/notify-prefs'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { FROM_TRANSACTIONAL, getResend, logEmail } from '@/lib/resend'

export type WorkerPostPaymentMode = 'owner_link' | 'worker_pays'

export type OrgPaymentContext = {
  mode: WorkerPostPaymentMode
  /** True when the posting user is an org `worker` (not the owner). */
  callerIsWorker: boolean
  /** All active owners of the org. */
  ownerIds: string[]
  /** The owner to record as the escrow payer (org creator if they're still an
   *  owner, else the first active owner). Null when the org has no owner. */
  primaryOwnerId: string | null
}

/**
 * Resolve, for a worker's post, how it should be paid for: the org's
 * `worker_post_payment_mode`, whether the caller is a worker, and the owner(s)
 * who can pay. Used by the job-create routes to decide between sending the
 * owner a payment link vs. charging the poster directly.
 */
export async function resolveOrgPaymentContext(
  organisationId: string,
  callerUserId: string
): Promise<OrgPaymentContext> {
  try {
    return await resolveOrgPaymentContextInner(organisationId, callerUserId)
  } catch (err) {
    // Defensive: the mode column ships with migration 0032. On a DB that
    // hasn't run it yet this query throws — booking must NOT break, so fall
    // back to the legacy behaviour (the poster pays at checkout).
    console.warn('[worker-post-payment] context unavailable (migration 0032?):', err)
    return {
      mode: 'worker_pays',
      callerIsWorker: false,
      ownerIds: [],
      primaryOwnerId: null,
    }
  }
}

async function resolveOrgPaymentContextInner(
  organisationId: string,
  callerUserId: string
): Promise<OrgPaymentContext> {
  return withServiceRole(async (tx) => {
    const [org] = await tx
      .select({
        mode: organisations.workerPostPaymentMode,
        createdBy: organisations.createdBy,
      })
      .from(organisations)
      .where(eq(organisations.id, organisationId))
      .limit(1)
    const mode: WorkerPostPaymentMode =
      org?.mode === 'worker_pays' ? 'worker_pays' : 'owner_link'

    const members = await tx
      .select({
        userId: organisationMembers.userId,
        orgRole: organisationMembers.orgRole,
      })
      .from(organisationMembers)
      .where(
        and(
          eq(organisationMembers.organisationId, organisationId),
          eq(organisationMembers.status, 'active')
        )
      )

    const caller = members.find((m) => m.userId === callerUserId)
    const ownerIds = members
      .filter((m) => m.orgRole === 'owner')
      .map((m) => m.userId)
    const primaryOwnerId =
      (org?.createdBy && ownerIds.includes(org.createdBy)
        ? org.createdBy
        : ownerIds[0]) ?? null

    return {
      mode,
      callerIsWorker: caller?.orgRole === 'worker',
      ownerIds,
      primaryOwnerId,
    }
  })
}

/**
 * Send the org owner(s) a Stripe payment link to publish a worker's post —
 * both to the in-app inbox (notification bell) and by email. Best-effort: a
 * delivery problem never throws, because the draft job + checkout already
 * exist and the owner can also be re-notified.
 */
export async function deliverOwnerPaymentLink(params: {
  ownerIds: string[]
  jobId: string
  checkoutUrl: string
  serviceLabel: string
  amountPounds: number
  posterName: string
}): Promise<void> {
  const { ownerIds, jobId, checkoutUrl, serviceLabel, amountPounds, posterName } =
    params
  if (ownerIds.length === 0) return

  const amount = `£${amountPounds.toFixed(0)}`
  const title = 'Payment needed to publish a job'
  const message = `${posterName} posted a ${serviceLabel} (${amount}). Complete payment to publish it.`

  // 1. In-app inbox: one row per owner, linking straight to the payment page.
  try {
    await withServiceRole((tx) =>
      tx.insert(notifications).values(
        ownerIds.map((userId) => ({
          userId,
          type: 'payment',
          title,
          message,
          link: checkoutUrl,
        }))
      )
    )
  } catch (err) {
    console.warn('[worker-post-payment] in-app notify failed:', err)
  }

  // 2. Email each owner (gated by their emailPaymentUpdates preference).
  try {
    const prefsById = new Map(
      await Promise.all(
        ownerIds.map(
          async (id) => [id, await loadUserNotificationPrefs(id)] as const
        )
      )
    )
    const admin = getSupabaseAdmin()
    const recipients: string[] = []
    for (const id of ownerIds) {
      if (prefsById.get(id)?.emailPaymentUpdates === false) continue
      const u = await admin.auth.admin.getUserById(id)
      const email = u.data?.user?.email
      if (email) recipients.push(email)
    }
    if (recipients.length > 0) {
      const subject = `Payment needed: publish ${posterName}'s ${serviceLabel}`
      const html = buildEmailHtml({
        posterName,
        serviceLabel,
        amount,
        checkoutUrl,
      })
      await Promise.allSettled(
        recipients.map((to) =>
          getResend().emails.send({
            from: FROM_TRANSACTIONAL,
            to: [to],
            subject,
            html,
          })
        )
      )
      await logEmail({
        functionName: 'worker-post-payment-link',
        recipientEmails: recipients,
        subject,
        resendId: null,
        errorMessage: null,
        metadata: { jobId },
      })
    }
  } catch (err) {
    console.warn('[worker-post-payment] email delivery failed:', err)
  }
}

function buildEmailHtml(p: {
  posterName: string
  serviceLabel: string
  amount: string
  checkoutUrl: string
}): string {
  return `
    <!DOCTYPE html>
    <html><head><meta charset="utf-8"></head>
    <body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;margin:0;padding:0;background:#f4f4f5;">
      <div style="max-width:600px;margin:0 auto;padding:20px;">
        <div style="background:#fff;border-radius:12px;padding:32px;box-shadow:0 1px 3px rgba(0,0,0,.1);">
          <h1 style="color:#18181b;font-size:22px;margin:0 0 16px;">Payment needed to publish a job</h1>
          <p style="color:#52525b;font-size:16px;line-height:1.5;margin:0 0 8px;"><strong>${escapeHtml(p.posterName)}</strong> in your organisation posted a <strong>${escapeHtml(p.serviceLabel)}</strong>.</p>
          <p style="color:#52525b;font-size:16px;line-height:1.5;margin:0 0 24px;">Complete the secure payment of <strong>${escapeHtml(p.amount)}</strong> to publish it and have it picked up by a verified Pro.</p>
          <div style="text-align:center;">
            <a href="${escapeHtml(p.checkoutUrl)}" style="display:inline-block;background:#0d9488;color:#fff;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:600;font-size:16px;">Pay &amp; publish</a>
          </div>
          <p style="color:#a1a1aa;font-size:12px;text-align:center;margin-top:24px;">This secure payment link is powered by Stripe. The job stays unpublished until payment completes.</p>
        </div>
      </div>
    </body></html>
  `.trim()
}
