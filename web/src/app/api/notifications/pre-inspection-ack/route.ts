import { and, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { errorResponse, escapeHtml, forbidden, ok } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import { FROM_NOTIFICATIONS, getResend, logEmail } from '@/lib/resend'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import {
  jobs,
  notificationPreferences,
  userRoles,
  withRLS,
  withServiceRole,
} from '@/db'

export const maxDuration = 30
export const runtime = 'nodejs'

const VALID_INSPECTION_TYPES = [
  'new_inventory',
  'check_in',
  'check_out',
  'mid_term',
  'interim',
] as const

const INSPECTION_LABELS: Record<(typeof VALID_INSPECTION_TYPES)[number], string> = {
  new_inventory: 'New Inventory',
  check_in: 'Check-In',
  check_out: 'Check-Out',
  mid_term: 'Mid-Term',
  interim: 'Interim',
}

const RequestSchema = z.object({
  jobId: z.string().uuid(),
  propertyAddress: z.string().trim().max(500).default(''),
  city: z.string().trim().max(100).default(''),
  postcode: z.string().trim().max(20).default(''),
  inspectionType: z.enum(VALID_INSPECTION_TYPES),
  scheduledDate: z.string().refine((s) => !Number.isNaN(Date.parse(s))),
  clientName: z.string().trim().max(255).default(''),
})

/**
 * POST /api/notifications/pre-inspection-ack — broadcast a "client confirmed
 * pre-inspection details" email to the assigned clerk + provider (or all
 * clerks if not yet assigned).
 * Replaces supabase/functions/notify-pre-inspection-ack/index.ts.
 */
export async function POST(req: Request) {
  const session = await authorizeRequest()
  if (session instanceof Response) return session

  try {
    const body = await req.json()
    const input = RequestSchema.parse(body)

    // Verify caller owns the job + collect clerk_id / provider_id while
    // RLS is enforcing visibility.
    const jobRow = await withRLS(session, async (tx) => {
      const [row] = await tx
        .select({
          id: jobs.id,
          clerkId: jobs.clerkId,
          providerId: jobs.providerId,
        })
        .from(jobs)
        .where(eq(jobs.id, input.jobId))
        .limit(1)
      return row
    })
    if (!jobRow) return forbidden()

    const directRecipients = [jobRow.clerkId, jobRow.providerId].filter(
      (id): id is string => Boolean(id)
    )

    // If unassigned, broadcast to all clerks. Service-role bypass — system
    // work on behalf of the verified job owner.
    const eligibleIds = await withServiceRole(async (tx) => {
      let candidateIds = directRecipients
      if (candidateIds.length === 0) {
        const clerkRows = await tx
          .select({ userId: userRoles.userId })
          .from(userRoles)
          .where(eq(userRoles.role, 'clerk'))
        candidateIds = clerkRows.map((r) => r.userId)
      }
      if (candidateIds.length === 0) return []

      const optedOut = await tx
        .select({ userId: notificationPreferences.userId })
        .from(notificationPreferences)
        .where(
          and(
            inArray(notificationPreferences.userId, candidateIds),
            eq(notificationPreferences.emailJobUpdates, false)
          )
        )
      const optedOutSet = new Set(
        optedOut
          .filter((p) => p.userId !== null)
          .map((p) => p.userId as string)
      )
      return candidateIds.filter((id) => !optedOutSet.has(id))
    })

    if (eligibleIds.length === 0) {
      return ok({ message: 'No recipients to notify', notifiedCount: 0 })
    }

    const admin = getSupabaseAdmin()
    const {
      data: { users },
      error: usersError,
    } = await admin.auth.admin.listUsers({ perPage: 1000 })
    if (usersError) throw usersError

    const eligibleSet = new Set(eligibleIds)
    const recipientEmails = users
      .filter((u) => eligibleSet.has(u.id) && !!u.email)
      .map((u) => u.email!)

    if (recipientEmails.length === 0) {
      return ok({ message: 'No recipient emails found', notifiedCount: 0 })
    }

    const formattedDate = new Date(input.scheduledDate).toLocaleDateString(
      'en-GB',
      { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }
    )
    const inspectionLabel = INSPECTION_LABELS[input.inspectionType]

    const safeClientName = escapeHtml(input.clientName || 'The client')
    const safeAddress = escapeHtml(input.propertyAddress)
    const safeCity = escapeHtml(input.city)
    const safePostcode = escapeHtml(input.postcode)
    const safeInspection = escapeHtml(inspectionLabel)
    const safeDate = escapeHtml(formattedDate)

    const subject = `Job Confirmed: ${inspectionLabel} at ${input.city}`
    const html = `
      <!DOCTYPE html>
      <html><head><meta charset="utf-8"></head>
      <body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;margin:0;padding:0;background:#f4f4f5;">
        <div style="max-width:600px;margin:0 auto;padding:20px;">
          <div style="background:#fff;border-radius:12px;padding:32px;box-shadow:0 1px 3px rgba(0,0,0,.1);">
            <div style="text-align:center;margin-bottom:24px;">
              <div style="display:inline-block;background:#10b981;color:#fff;padding:8px 16px;border-radius:20px;font-size:14px;font-weight:600;">✓ Client Confirmed</div>
              <h1 style="color:#18181b;font-size:24px;margin:16px 0 0;">Pre-Inspection Details Verified</h1>
            </div>
            <p style="color:#52525b;font-size:16px;line-height:1.5;margin-bottom:24px;"><strong>${safeClientName}</strong> has confirmed that all property details are accurate and the job is ready to proceed.</p>
            <div style="background:#f4f4f5;border-radius:8px;padding:20px;margin-bottom:24px;">
              <h2 style="color:#18181b;font-size:18px;margin:0 0 16px;">Job Details</h2>
              <table style="width:100%;border-collapse:collapse;">
                <tr><td style="padding:8px 0;color:#71717a;font-size:14px;">Type:</td><td style="padding:8px 0;color:#18181b;font-size:14px;font-weight:600;">${safeInspection}</td></tr>
                <tr><td style="padding:8px 0;color:#71717a;font-size:14px;">Property:</td><td style="padding:8px 0;color:#18181b;font-size:14px;">${safeAddress}</td></tr>
                <tr><td style="padding:8px 0;color:#71717a;font-size:14px;">Location:</td><td style="padding:8px 0;color:#18181b;font-size:14px;">${safeCity}, ${safePostcode}</td></tr>
                <tr><td style="padding:8px 0;color:#71717a;font-size:14px;">Scheduled:</td><td style="padding:8px 0;color:#18181b;font-size:14px;">${safeDate}</td></tr>
              </table>
            </div>
            <div style="background:#ecfdf5;border:1px solid #10b981;border-radius:8px;padding:16px;margin-bottom:24px;">
              <p style="color:#065f46;font-size:14px;margin:0;"><strong>What this means:</strong> The client has verified the property details, room counts, and confirmed access arrangements. You can proceed with confidence.</p>
            </div>
            <div style="text-align:center;">
              <a href="${escapeHtml(process.env.NEXT_PUBLIC_SITE_URL ?? 'https://listd.co.uk')}/clerk/jobs/${input.jobId}" style="display:inline-block;background:#0d9488;color:#fff;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:600;font-size:16px;">View Job Details</a>
            </div>
          </div>
          <div style="text-align:center;margin-top:20px;"><p style="color:#a1a1aa;font-size:12px;">&copy; ${new Date().getFullYear()} LISTD. All rights reserved.</p></div>
        </div>
      </body></html>
    `.trim()

    const { data, error } = await getResend().emails.send({
      from: FROM_NOTIFICATIONS,
      to: recipientEmails,
      subject,
      html,
    })

    await logEmail({
      functionName: 'notify-pre-inspection-ack',
      recipientEmails,
      subject,
      resendId: data?.id ?? null,
      errorMessage: error ? error.message : null,
      metadata: { jobId: input.jobId, inspectionType: input.inspectionType, city: input.city },
    })

    return ok({ success: !error, notifiedCount: recipientEmails.length })
  } catch (err) {
    return errorResponse(err)
  }
}
