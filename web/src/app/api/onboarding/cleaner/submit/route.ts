import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { errorResponse, ok } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import { callerIp, callerUserAgent, logAuditEvent } from '@/lib/audit'
import { notifications, profiles, userRoles, withServiceRole } from '@/db'
import { ukPhone } from '@/lib/uk-phone'
import { CLEAN_TYPE_KEYS } from '@/lib/pricing-matrix'

export const maxDuration = 15
export const runtime = 'nodejs'

/**
 * POST /api/onboarding/cleaner/submit — single-step submit for the cleaner
 * onboarding flow. Writes identity, coverage, DBS and insurance to the shared
 * `profiles` columns (same shape as clerk verification so the admin review
 * surface at /admin/clerks/[id] works unchanged), seeds the cleaner's offered
 * services with the three clean levels, flips `verification_status` to
 * `pending_verification`, and notifies admins.
 *
 * Document fields are Supabase Storage paths uploaded client-side; this route
 * only persists the references.
 */
const RequestSchema = z
  .object({
    fullName: z.string().trim().min(1).max(100),
    phone: ukPhone,
    governmentIdUrl: z.string().min(1).max(500),
    governmentIdExpiry: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    emergencyContactName: z.string().trim().min(1).max(100),
    emergencyContactPhone: ukPhone,
    coverageAreas: z.array(z.string().trim().min(1).max(10)).min(1).max(50),
    dbsCertificateUrl: z.string().min(1).max(500),
    dbsExpiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    insuranceUrl: z.string().min(1).max(500),
    insuranceExpiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    insuranceProvider: z.string().trim().min(1).max(100),
    coverAmount: z.string().trim().max(40).optional(),
  })
  .strict()

export async function POST(req: Request) {
  const session = await authorizeRequest()
  if (session instanceof Response) return session

  try {
    const body = RequestSchema.parse(await req.json())
    const ip = callerIp(req)
    const ua = callerUserAgent(req)

    // Pack insurance into the existing text column (provider|cover|path),
    // matching the clerk flow so the admin review reads it the same way.
    const insuranceDetails = [
      body.insuranceProvider,
      body.coverAmount ?? '',
      body.insuranceUrl,
    ].join('|')

    // Cleaners perform all three clean levels by default.
    const serviceTypesOffered = [
      CLEAN_TYPE_KEYS.light,
      CLEAN_TYPE_KEYS.general,
      CLEAN_TYPE_KEYS.deep,
    ]

    const adminUserIds = await withServiceRole(async (tx) => {
      await tx
        .update(profiles)
        .set({
          fullName: body.fullName,
          phone: body.phone,
          governmentIdUrl: body.governmentIdUrl,
          governmentIdExpiry: body.governmentIdExpiry ?? null,
          emergencyContactName: body.emergencyContactName,
          emergencyContactPhone: body.emergencyContactPhone,
          coverageAreas: body.coverageAreas.map((p) => p.toUpperCase()),
          serviceTypesOffered,
          dbsCertificateUrl: body.dbsCertificateUrl,
          dbsExpiry: body.dbsExpiry,
          insuranceDetails,
          insuranceExpiry: body.insuranceExpiry,
          verificationStatus: 'pending_verification',
          onboardingCompleted: true,
        })
        .where(eq(profiles.userId, session.userId))

      await logAuditEvent(tx, {
        category: 'verification',
        action: 'verification.submitted',
        actorUserId: session.userId,
        targetType: 'profile',
        targetId: session.userId,
        payload: {
          role: 'cleaner',
          insuranceProvider: body.insuranceProvider,
          insuranceExpiry: body.insuranceExpiry,
          dbsExpiry: body.dbsExpiry,
        },
        ipAddress: ip,
        userAgent: ua,
      })

      const admins = await tx
        .select({ userId: userRoles.userId })
        .from(userRoles)
        .where(eq(userRoles.role, 'admin'))

      if (admins.length > 0) {
        const fullName = body.fullName || session.email || 'A new cleaner'
        await tx.insert(notifications).values(
          admins.map((a) => ({
            userId: a.userId,
            type: 'system',
            title: 'New cleaner verification request',
            message: `${fullName} has submitted their cleaner verification documents.`,
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
