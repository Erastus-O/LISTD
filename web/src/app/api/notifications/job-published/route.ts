import { eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { errorResponse, escapeHtml, forbidden, ok } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import {
  FROM_NOTIFICATIONS,
  getResend,
  logEmail,
} from '@/lib/resend'
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
const VALID_TIME_SLOTS = ['morning', 'afternoon', 'evening'] as const

const INSPECTION_LABELS: Record<(typeof VALID_INSPECTION_TYPES)[number], string> = {
  new_inventory: 'New Inventory',
  check_in: 'Check-In',
  check_out: 'Check-Out',
  mid_term: 'Mid-Term',
  interim: 'Interim',
}
const TIME_SLOT_LABELS: Record<(typeof VALID_TIME_SLOTS)[number], string> = {
  morning: 'Morning (9:00 - 12:00)',
  afternoon: 'Afternoon (12:00 - 17:00)',
  evening: 'Evening (17:00 - 20:00)',
}

const RequestSchema = z.object({
  jobId: z.string().uuid(),
  propertyAddress: z.string().trim().max(500).default(''),
  city: z.string().trim().max(100).default(''),
  postcode: z.string().trim().max(20).default(''),
  inspectionType: z.enum(VALID_INSPECTION_TYPES),
  scheduledDate: z.string().refine((s) => !Number.isNaN(Date.parse(s)), {
    message: 'Invalid date',
  }),
  timeSlot: z.enum(VALID_TIME_SLOTS).optional(),
})

/**
 * POST /api/notifications/job-published — broadcast a "new job available"
 * email to all clerks who haven't opted out.
 * Replaces supabase/functions/notify-job-published/index.ts.
 */
export async function POST(req: Request) {
  const session = await authorizeRequest()
  if (session instanceof Response) return session

  try {
    const body = await req.json()
    const input = RequestSchema.parse(body)

    // 1. Verify the caller owns this job. RLS on `jobs` only exposes the
    //    caller's own rows, so a missing result means either no such job or
    //    not theirs — same response either way.
    const ownsJob = await withRLS(session, async (tx) => {
      const rows = await tx
        .select({ id: jobs.id })
        .from(jobs)
        .where(eq(jobs.id, input.jobId))
        .limit(1)
      return rows.length > 0
    })
    if (!ownsJob) return forbidden()

    // 2. Cross-tenant broadcast — fetch all clerks and their email-opt-in
    //    preferences. RLS bypass is intentional per ADR-001 (system-level
    //    work on behalf of the verified job owner).
    const eligibleClerkIds = await withServiceRole(async (tx) => {
      const clerkRows = await tx
        .select({ userId: userRoles.userId })
        .from(userRoles)
        .where(eq(userRoles.role, 'clerk'))

      if (clerkRows.length === 0) return []

      const clerkIds = clerkRows.map((r) => r.userId)
      const optedOut = await tx
        .select({ userId: notificationPreferences.userId })
        .from(notificationPreferences)
        .where(
          inArray(notificationPreferences.userId, clerkIds)
        )

      const optedOutSet = new Set(
        optedOut
          .filter((p) => p.userId !== null)
          .map((p) => p.userId as string)
      )
      return clerkIds.filter((id) => !optedOutSet.has(id))
    })

    if (eligibleClerkIds.length === 0) {
      return ok({ message: 'No clerks to notify', notifiedCount: 0 })
    }

    // 3. auth.users isn't reachable via Drizzle — use the Supabase admin API.
    const admin = getSupabaseAdmin()
    const {
      data: { users },
      error: usersError,
    } = await admin.auth.admin.listUsers({ perPage: 1000 })
    if (usersError) throw usersError

    const eligibleSet = new Set(eligibleClerkIds)
    const recipientEmails = users
      .filter((u) => eligibleSet.has(u.id) && !!u.email)
      .map((u) => u.email!)

    if (recipientEmails.length === 0) {
      return ok({ message: 'No clerk emails found', notifiedCount: 0 })
    }

    // 4. Format and send.
    const formattedDate = new Date(input.scheduledDate).toLocaleDateString(
      'en-GB',
      { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }
    )
    const inspectionLabel = INSPECTION_LABELS[input.inspectionType]
    const timeSlotLabel = input.timeSlot
      ? TIME_SLOT_LABELS[input.timeSlot]
      : 'Flexible'

    const safeAddress = escapeHtml(input.propertyAddress)
    const safeCity = escapeHtml(input.city)
    const safePostcode = escapeHtml(input.postcode)
    const safeInspection = escapeHtml(inspectionLabel)
    const safeDate = escapeHtml(formattedDate)
    const safeTimeSlot = escapeHtml(timeSlotLabel)

    const subject = `New Job Available: ${inspectionLabel} in ${input.city}`
    const html = `
      <!DOCTYPE html>
      <html><head><meta charset="utf-8"></head>
      <body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;margin:0;padding:0;background:#f4f4f5;">
        <div style="max-width:600px;margin:0 auto;padding:20px;">
          <div style="background:#fff;border-radius:12px;padding:32px;box-shadow:0 1px 3px rgba(0,0,0,.1);">
            <div style="text-align:center;margin-bottom:24px;"><h1 style="color:#18181b;font-size:24px;margin:0;">New Job Available!</h1></div>
            <p style="color:#52525b;font-size:16px;line-height:1.5;margin-bottom:24px;">A new inspection job has been published and is available for you to accept.</p>
            <div style="background:#f4f4f5;border-radius:8px;padding:20px;margin-bottom:24px;">
              <h2 style="color:#18181b;font-size:18px;margin:0 0 16px;">Job Details</h2>
              <table style="width:100%;border-collapse:collapse;">
                <tr><td style="padding:8px 0;color:#71717a;font-size:14px;">Type:</td><td style="padding:8px 0;color:#18181b;font-size:14px;font-weight:600;">${safeInspection}</td></tr>
                <tr><td style="padding:8px 0;color:#71717a;font-size:14px;">Property:</td><td style="padding:8px 0;color:#18181b;font-size:14px;">${safeAddress}</td></tr>
                <tr><td style="padding:8px 0;color:#71717a;font-size:14px;">Location:</td><td style="padding:8px 0;color:#18181b;font-size:14px;">${safeCity}, ${safePostcode}</td></tr>
                <tr><td style="padding:8px 0;color:#71717a;font-size:14px;">Date:</td><td style="padding:8px 0;color:#18181b;font-size:14px;">${safeDate}</td></tr>
                <tr><td style="padding:8px 0;color:#71717a;font-size:14px;">Time Slot:</td><td style="padding:8px 0;color:#18181b;font-size:14px;">${safeTimeSlot}</td></tr>
              </table>
            </div>
            <div style="text-align:center;">
              <a href="${escapeHtml(process.env.NEXT_PUBLIC_SITE_URL ?? 'https://listd.co.uk')}/clerk/jobs/available" style="display:inline-block;background:#0d9488;color:#fff;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:600;font-size:16px;">View Available Jobs</a>
            </div>
            <p style="color:#a1a1aa;font-size:12px;text-align:center;margin-top:32px;">First-come, first-served.</p>
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
      functionName: 'notify-job-published',
      recipientEmails,
      subject,
      resendId: data?.id ?? null,
      errorMessage: error ? error.message : null,
      metadata: {
        jobId: input.jobId,
        inspectionType: input.inspectionType,
        city: input.city,
        postcode: input.postcode,
      },
    })

    return ok({ success: !error, notifiedCount: recipientEmails.length })
  } catch (err) {
    return errorResponse(err)
  }
}
