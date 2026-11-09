import { z } from 'zod'
import {
  badRequest,
  errorResponse,
  ok,
} from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import { notifications, notificationQueue, withServiceRole } from '@/db'
import { callerIp, callerUserAgent, logAuditEvent } from '@/lib/audit'
import {
  resolveBroadcastRecipients,
  type BroadcastTarget,
} from '@/lib/dashboard/admin-notifications'

export const maxDuration = 30
export const runtime = 'nodejs'

const CONFIRM_TOKEN = 'SEND'
const CONFIRM_THRESHOLD = 50
const BATCH_SIZE = 100

const ChannelSchema = z.object({
  inapp: z.boolean(),
  email: z.boolean(),
  sms: z.boolean(),
})

const RequestSchema = z
  .object({
    target: z.enum(['all_clients', 'all_clerks', 'all_users', 'individual']),
    /** Required when `target === 'individual'`. */
    userId: z.string().uuid().optional(),
    channels: ChannelSchema,
    subject: z.string().trim().max(200).optional(),
    body: z.string().trim().min(1).max(4000),
    /** Free-text confirmation: required when the resolved recipient count
     *  exceeds `CONFIRM_THRESHOLD`. Admin must type `SEND` exactly. */
    confirmText: z.string().optional(),
  })
  .strict()
  .refine(
    (b) => b.channels.inapp || b.channels.email || b.channels.sms,
    'At least one channel must be selected'
  )
  .refine(
    (b) => b.target !== 'individual' || !!b.userId,
    'userId is required when target is "individual"'
  )

/**
 * POST /api/admin/notifications/broadcast — send a manual notification to
 * the resolved recipient set (Lovable port — `SendNotificationSection`).
 *
 * Guardrails:
 *   - Typed-confirm: any broadcast > 50 recipients requires
 *     `confirmText: "SEND"`. Stops a slip-of-the-mouse blast to every user.
 *   - Audit row: every send writes
 *     `platform_setting/notification.broadcast` with target, channel mask,
 *     recipient count, subject preview. The actor user id + IP are stamped
 *     by `logAuditEvent` so the forensic question "who sent this?" has a
 *     single answer.
 *
 * Insertion batches:
 *   - In-app rows: 100 at a time into `notifications`.
 *   - Email / SMS rows: 100 at a time into `notification_queue` (channel
 *     workers drain it separately).
 */
export async function POST(req: Request) {
  const session = await authorizeRequest('admin')
  if (session instanceof Response) return session

  try {
    const body = RequestSchema.parse(await req.json())
    const ip = callerIp(req)
    const ua = callerUserAgent(req)

    const target: BroadcastTarget =
      body.target === 'individual'
        ? { kind: 'individual', userId: body.userId! }
        : body.target
    const recipients = await resolveBroadcastRecipients(target)
    if (recipients.length === 0) {
      return badRequest('No recipients matched the target.')
    }
    if (
      recipients.length > CONFIRM_THRESHOLD &&
      body.confirmText?.trim() !== CONFIRM_TOKEN
    ) {
      return badRequest(
        `Confirmation required. Type "${CONFIRM_TOKEN}" to broadcast to ${recipients.length} recipients.`
      )
    }

    const subjectClean = body.subject?.trim() || null

    await withServiceRole(async (tx) => {
      if (body.channels.inapp) {
        const rows = recipients.map((userId) => ({
          userId,
          type: 'announcement',
          title: subjectClean || 'Notification',
          message: body.body,
        }))
        for (let i = 0; i < rows.length; i += BATCH_SIZE) {
          await tx.insert(notifications).values(rows.slice(i, i + BATCH_SIZE))
        }
      }

      const queueRows: Array<{
        userId: string
        channel: string
        subject: string | null
        body: string
        status: string
      }> = []
      if (body.channels.email) {
        for (const userId of recipients) {
          queueRows.push({
            userId,
            channel: 'email',
            subject: subjectClean,
            body: body.body,
            status: 'queued',
          })
        }
      }
      if (body.channels.sms) {
        for (const userId of recipients) {
          queueRows.push({
            userId,
            channel: 'sms',
            subject: null,
            body: body.body,
            status: 'queued',
          })
        }
      }
      if (queueRows.length > 0) {
        for (let i = 0; i < queueRows.length; i += BATCH_SIZE) {
          await tx
            .insert(notificationQueue)
            .values(queueRows.slice(i, i + BATCH_SIZE))
        }
      }

      await logAuditEvent(tx, {
        category: 'platform_setting',
        action: 'notification.broadcast',
        actorUserId: session.userId,
        targetType: 'broadcast',
        targetId: null,
        payload: {
          target: body.target,
          targetUserId:
            body.target === 'individual' ? body.userId : null,
          recipientCount: recipients.length,
          channels: {
            inapp: body.channels.inapp,
            email: body.channels.email,
            sms: body.channels.sms,
          },
          subjectPreview: previewText(subjectClean, 80),
          bodyPreview: previewText(body.body, 200),
          requiredConfirm: recipients.length > CONFIRM_THRESHOLD,
        },
        ipAddress: ip,
        userAgent: ua,
      })
    })

    return ok({ success: true, recipientCount: recipients.length })
  } catch (err) {
    console.error('[admin/notifications/broadcast] error:', err)
    return errorResponse(err)
  }
}

function previewText(s: string | null, max: number): string | null {
  if (s === null) return null
  return s.length > max ? `${s.slice(0, max)}…` : s
}
