import 'server-only'
import { Resend } from 'resend'
import { emailLogs, withServiceRole } from '@/db'
import { getTemplateVersion } from './email-templates'

let _resend: Resend | null = null

/**
 * Lazy-initialised Resend client.
 *
 * Avoids throwing at module-eval time during `next build` when RESEND_API_KEY
 * isn't set — the throw happens only when something actually tries to send.
 */
export function getResend(): Resend {
  if (_resend) return _resend
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    throw new Error('RESEND_API_KEY is not set')
  }
  _resend = new Resend(apiKey)
  return _resend
}

// Sending identities must live on the Resend-verified domain. We verified the
// `updates.listd.co.uk` subdomain (keeps sending reputation off the apex).
// Reply-to stays on the apex — it's a monitored inbox and needs no verification.
export const FROM_TRANSACTIONAL = 'LISTD Pro <noreply@updates.listd.co.uk>'
export const FROM_NOTIFICATIONS = 'LISTD <notifications@updates.listd.co.uk>'
export const FROM_CONTACT = 'LISTD Contact Form <noreply@updates.listd.co.uk>'
export const REPLY_TO_DEFAULT = 'hello@listd.co.uk'

type LogEmailParams = {
  functionName: string
  recipientEmails: string[]
  subject: string
  resendId: string | null
  errorMessage?: string | null
  metadata?: Record<string, unknown>
}

/**
 * Append one row per recipient to email_logs. Always uses the service-role
 * connection (RLS bypass): the email_logs RLS policy is admin-read only,
 * and writes happen on every email send regardless of caller.
 *
 * Auto-attaches `metadata.templateVersion` from
 * [email-templates.ts](./email-templates.ts) when `functionName` is a known
 * template id. Caller-supplied metadata wins on key conflict so a handler
 * can override during a controlled re-send (M2 #14).
 */
export async function logEmail({
  functionName,
  recipientEmails,
  subject,
  resendId,
  errorMessage = null,
  metadata = {},
}: LogEmailParams): Promise<void> {
  if (recipientEmails.length === 0) return
  const status: 'sent' | 'failed' = resendId && !errorMessage ? 'sent' : 'failed'
  const version = getTemplateVersion(functionName)
  const enrichedMetadata =
    version !== null
      ? { templateVersion: version, ...metadata }
      : metadata
  await withServiceRole(async (tx) =>
    tx.insert(emailLogs).values(
      recipientEmails.map((recipientEmail) => ({
        functionName,
        recipientEmail,
        subject,
        status,
        resendId,
        errorMessage,
        metadata: enrichedMetadata,
      }))
    )
  )
}
