import 'server-only'
import twilio, { type Twilio } from 'twilio'
import { smsLogs, withServiceRole } from '@/db'
import { toE164UkPhone } from '@/lib/uk-phone'

/**
 * Twilio SMS helper. Two design rules:
 *
 *   - **Never throws.** `sendSms(...)` returns a discriminated result
 *     and every send writes an `sms_logs` row. A Twilio outage degrades
 *     to "no SMS this round" plus a log entry; it never 500s the caller
 *     (typically a cron or notification handler).
 *
 *   - **Graceful no-op on missing env.** If `TWILIO_ACCOUNT_SID` /
 *     `TWILIO_AUTH_TOKEN` aren't set, every call returns
 *     `{ ok: false, status: 'disabled' }` with one info-level log on
 *     first use. Matches the cache/push/rate-limit pattern so dev
 *     environments without Twilio creds just work.
 *
 * Routing preference: a `TWILIO_MESSAGING_SERVICE_SID` (MG...) is the
 * preferred sender — Twilio Messaging Services handle failover, sender
 * pool routing, and automatic STOP-keyword opt-out at the carrier
 * level. Falls back to `TWILIO_FROM_NUMBER` when the service SID is
 * absent. Don't set both — the service SID always wins.
 */

let _client: Twilio | null | undefined
let _warnedDisabled = false

function getClient(): Twilio | null {
  if (_client !== undefined) return _client
  const sid = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  if (!sid || !token) {
    if (!_warnedDisabled) {
      console.info(
        '[sms] disabled : TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN not set; sends will no-op'
      )
      _warnedDisabled = true
    }
    _client = null
    return null
  }
  _client = twilio(sid, token)
  return _client
}

function getSender(): { messagingServiceSid?: string; from?: string } | null {
  const service = process.env.TWILIO_MESSAGING_SERVICE_SID
  if (service) return { messagingServiceSid: service }
  const from = process.env.TWILIO_FROM_NUMBER
  if (from) return { from }
  return null
}

export type SendSmsInput = {
  /** Logical send site — 'appointment-reminder', 'password-reset-otp',
   *  'sms-stub-fallback'. Indexed in `sms_logs` for forensics. */
  functionName: string
  /** UK phone (any format `uk-phone.ts` accepts) or a pre-normalised
   *  E.164 string. Non-UK numbers currently rejected — extend
   *  `toE164UkPhone` if you need international support. */
  toPhone: string
  body: string
  /** Optional. The user we're texting — populates `sms_logs.recipient_user_id`
   *  so admins can answer "what did we send this clerk?". */
  recipientUserId?: string | null
  /** Free-form context bag. Matches the email_logs convention. */
  metadata?: Record<string, unknown>
}

export type SendSmsResult =
  | { ok: true; messageSid: string }
  | {
      ok: false
      status:
        | 'disabled'
        | 'no-sender'
        | 'invalid-phone'
        | 'twilio-error'
        | 'log-failed'
      reason?: string
    }

/**
 * Send a single SMS and write an `sms_logs` row. Honour the caller's
 * preference check upstream — this helper assumes you've already
 * confirmed the user opted in.
 */
export async function sendSms(input: SendSmsInput): Promise<SendSmsResult> {
  const e164 = toE164UkPhone(input.toPhone)
  if (!e164) {
    await logSms({
      functionName: input.functionName,
      recipientUserId: input.recipientUserId ?? null,
      recipientPhone: input.toPhone,
      body: input.body,
      status: 'failed',
      errorCode: 'invalid-phone',
      errorMessage: 'Not a recognisable UK number',
      metadata: input.metadata,
    })
    return { ok: false, status: 'invalid-phone' }
  }

  const client = getClient()
  if (!client) {
    // Don't write a log row for the disabled path — it'd drown the
    // useful events when running locally without Twilio creds.
    return { ok: false, status: 'disabled' }
  }

  const sender = getSender()
  if (!sender) {
    await logSms({
      functionName: input.functionName,
      recipientUserId: input.recipientUserId ?? null,
      recipientPhone: e164,
      body: input.body,
      status: 'failed',
      errorCode: 'no-sender',
      errorMessage:
        'Set TWILIO_MESSAGING_SERVICE_SID or TWILIO_FROM_NUMBER',
      metadata: input.metadata,
    })
    return { ok: false, status: 'no-sender' }
  }

  try {
    const message = await client.messages.create({
      to: e164,
      body: input.body,
      ...sender,
    })
    await logSms({
      functionName: input.functionName,
      recipientUserId: input.recipientUserId ?? null,
      recipientPhone: e164,
      body: input.body,
      status: 'sent',
      twilioMessageSid: message.sid,
      metadata: input.metadata,
    })
    return { ok: true, messageSid: message.sid }
  } catch (err) {
    // Twilio errors carry `code` (numeric) + `message` + `status`. We
    // serialise the bits useful in support ("21610 = blacklisted",
    // "21614 = invalid number").
    const e = err as { code?: number; message?: string; status?: number }
    await logSms({
      functionName: input.functionName,
      recipientUserId: input.recipientUserId ?? null,
      recipientPhone: e164,
      body: input.body,
      status: 'failed',
      errorCode: e?.code ? String(e.code) : null,
      errorMessage: e?.message ?? String(err),
      metadata: input.metadata,
    })
    return {
      ok: false,
      status: 'twilio-error',
      reason: e?.message ?? String(err),
    }
  }
}

/** Log a "skipped because user opted out / no phone on file" outcome
 *  without dialling Twilio. Useful for the notify-prefs caller to
 *  record consent decisions next to actual sends in the audit log. */
export async function logSmsSkipped(input: {
  functionName: string
  recipientUserId: string | null
  recipientPhone: string | null
  body: string
  reason: 'opt_out' | 'no_phone'
  metadata?: Record<string, unknown>
}): Promise<void> {
  await logSms({
    functionName: input.functionName,
    recipientUserId: input.recipientUserId,
    recipientPhone: input.recipientPhone ?? '(none)',
    body: input.body,
    status:
      input.reason === 'opt_out' ? 'skipped_opt_out' : 'skipped_no_phone',
    metadata: input.metadata,
  })
}

type LogSmsParams = {
  functionName: string
  recipientUserId: string | null
  recipientPhone: string
  body: string
  status: 'sent' | 'failed' | 'skipped_opt_out' | 'skipped_no_phone'
  twilioMessageSid?: string | null
  errorCode?: string | null
  errorMessage?: string | null
  metadata?: Record<string, unknown>
}

async function logSms(params: LogSmsParams): Promise<void> {
  try {
    await withServiceRole(async (tx) => {
      await tx.insert(smsLogs).values({
        functionName: params.functionName,
        recipientUserId: params.recipientUserId,
        recipientPhone: params.recipientPhone,
        body: params.body.slice(0, 1600), // SMS hard cap is 1600 across segments
        status: params.status,
        twilioMessageSid: params.twilioMessageSid ?? null,
        errorCode: params.errorCode ?? null,
        errorMessage: params.errorMessage ?? null,
        metadata: params.metadata ?? {},
      })
    })
  } catch (err) {
    // Logging failure shouldn't 500 the send path. Worst case we lose
    // visibility on this one row; Twilio Console still has the truth.
    console.warn('[sms] log write failed:', err)
  }
}
