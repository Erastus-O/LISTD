import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { errorResponse, ok } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import { callerIp, callerUserAgent, logAuditEvent } from '@/lib/audit'
import {
  notifications,
  profiles,
  userRoles,
  withServiceRole,
} from '@/db'

export const maxDuration = 15
export const runtime = 'nodejs'

const RequestSchema = z
  .object({
    insuranceUrl: z.string().min(1).max(500),
    insuranceExpiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    insuranceProvider: z.string().trim().min(1).max(100),
    coverAmount: z.string().trim().max(40).optional(),
  })
  .strict()

/**
 * PATCH /api/onboarding/clerk/insurance — Step 5: Professional Indemnity
 * Insurance upload. Also the submit step: flips `verification_status` to
 * `pending_verification` and notifies admins in-app.
 *
 * Admin review (approve/reject) happens at
 * [/admin/clerks/[clerkId]](../../../admin/clerks/[clerkId]) and triggers a
 * Resend email back to the clerk.
 */
export async function PATCH(req: Request) {
  const session = await authorizeRequest()
  if (session instanceof Response) return session

  try {
    const { insuranceUrl, insuranceExpiry, insuranceProvider, coverAmount } =
      RequestSchema.parse(await req.json())

    // We pack the insurance metadata into the existing `insurance_details`
    // text column to avoid a wider schema delta. Format:
    // "<provider>|<cover>|<storage_path>".
    const insuranceDetails = [
      insuranceProvider,
      coverAmount ?? '',
      insuranceUrl,
    ].join('|')

    const ip = callerIp(req)
    const ua = callerUserAgent(req)

    const adminUserIds = await withServiceRole(async (tx) => {
      await tx
        .update(profiles)
        .set({
          insuranceDetails,
          insuranceExpiry,
          verificationStatus: 'pending_verification',
          onboardingCompleted: true,
        })
        .where(eq(profiles.userId, session.userId))

      // Audit row for the verification submit. Same tx as the profile flip
      // so a partial failure can't leave a `pending_verification` profile
      // without the matching forensic record (closes the
      // `verification.submitted` site of M1 #22 Package C).
      await logAuditEvent(tx, {
        category: 'verification',
        action: 'verification.submitted',
        actorUserId: session.userId,
        targetType: 'profile',
        targetId: session.userId,
        payload: {
          insuranceProvider,
          insuranceExpiry,
        },
        ipAddress: ip,
        userAgent: ua,
      })

      const admins = await tx
        .select({ userId: userRoles.userId })
        .from(userRoles)
        .where(eq(userRoles.role, 'admin'))

      if (admins.length > 0) {
        const fullName = session.profile?.fullName ?? session.email ?? 'A new clerk'
        await tx.insert(notifications).values(
          admins.map((a) => ({
            userId: a.userId,
            type: 'system',
            title: 'New clerk verification request',
            message: `${fullName} has submitted their verification documents.`,
            link: `/admin/clerks/${session.userId}`,
          }))
        )
      }

      return admins.map((a) => a.userId)
    })

    return ok({ success: true, adminsNotified: adminUserIds.length })
  } catch (err) {
    return errorResponse(err)
  }
}
