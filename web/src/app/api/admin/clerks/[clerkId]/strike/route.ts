import { z } from 'zod'
import { created, errorResponse } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import { notifications, strikes, withServiceRole } from '@/db'
import { callerIp, callerUserAgent, logAuditEvent } from '@/lib/audit'

export const maxDuration = 15
export const runtime = 'nodejs'

const RequestSchema = z.object({
  reason: z.string().trim().min(1).max(2000),
  /**
   * Lovable's existing dialog uses 1 (warning) and 2 (serious). Higher
   * severities are reserved for future use; the cron / suspension logic
   * isn't tied to severity yet, only to count of active strikes.
   */
  severity: z.number().int().min(1).max(3),
  jobId: z.string().uuid().optional(),
})

type Params = Promise<{ clerkId: string }>

/**
 * POST /api/admin/clerks/[clerkId]/strike — admin issues a strike against a
 * clerk (M1 #22 Package C, S6a of the Lovable port).
 *
 * Mirrors Lovable's IssueStrikeDialog write — same `strikes` table — but
 * routes through Next so the audit row is written atomically with the
 * strike row, and so the in-app notification to the affected clerk fires
 * server-side (rather than relying on a separate Lovable trigger).
 *
 * **Audit row** lands inside the same tx as the insert, so a partial
 * failure can't produce a strike without the audit trail. Closes the
 * `strike.issued` site of M1 #22 Package C.
 */
export async function POST(req: Request, { params }: { params: Params }) {
  const session = await authorizeRequest('admin')
  if (session instanceof Response) return session

  try {
    const { clerkId } = await params
    const body = RequestSchema.parse(await req.json())
    const ip = callerIp(req)
    const ua = callerUserAgent(req)

    const inserted = await withServiceRole(async (tx) => {
      const [strike] = await tx
        .insert(strikes)
        .values({
          clerkId,
          reason: body.reason,
          severity: body.severity,
          issuedBy: session.userId,
        })
        .returning()

      // Audit row — same tx so partial failure can't produce a strike
      // without a forensic record (closes M1 #22 F6 — strike issuance was
      // previously "logged by destination only").
      await logAuditEvent(tx, {
        category: 'strike',
        action: 'strike.issued',
        actorUserId: session.userId,
        targetType: 'profile',
        targetId: clerkId,
        payload: {
          strikeId: strike.id,
          severity: body.severity,
          reason: body.reason,
          jobId: body.jobId ?? null,
        },
        ipAddress: ip,
        userAgent: ua,
      })

      // Notify the clerk in-app. The Lovable dialog historically did a
      // separate insert; centralising it here means a single round-trip
      // and consistent shape with the verification-decision flow.
      await tx.insert(notifications).values({
        userId: clerkId,
        type: 'strike',
        title:
          body.severity >= 2
            ? 'Serious strike issued'
            : 'Warning strike issued',
        message: `An admin has issued a strike against your account: ${body.reason}`,
        link: '/clerk/dashboard',
      })

      return strike
    })

    return created({ strike: inserted })
  } catch (err) {
    console.error('[admin/clerks/strike] error:', err)
    return errorResponse(err)
  }
}
