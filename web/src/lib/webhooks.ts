import 'server-only'
import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Default replay-protection window (5 minutes). Inbound webhooks older than
 * this against the `x-listd-timestamp` header are rejected even when the
 * signature checks out, defeating capture-replay against the same payload.
 *
 * 5 minutes matches Stripe / Svix industry default and is broad enough to
 * tolerate clock skew without being a useful replay window in practice.
 */
export const WEBHOOK_REPLAY_WINDOW_SECONDS = 5 * 60

/**
 * Verify an HMAC-SHA256 signature against the raw request body.
 * Used for Make.com and other external webhooks per the M-Pre plan.
 *
 * @param payload  raw request body as a string (read with `await req.text()`)
 * @param signature  hex-encoded signature from the request header
 * @param secret  shared secret from env
 */
export function verifyHmacSha256(
  payload: string,
  signature: string,
  secret: string
): boolean {
  const expected = createHmac('sha256', secret).update(payload).digest('hex')
  if (signature.length !== expected.length) return false
  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  } catch {
    return false
  }
}

/**
 * Verify a Vercel Cron request. Vercel sends `Authorization: Bearer <CRON_SECRET>`
 * to scheduled route handlers. Returns true if the header matches.
 */
export function verifyCronAuth(req: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const header = req.headers.get('authorization')
  return header === `Bearer ${secret}`
}

/**
 * Verify an `x-api-key` header matches `EXTERNAL_API_KEY` — used by the
 * existing get-new-jobs / get-published-jobs / recycle-jobs / upsell-reminders
 * external API surface.
 */
export function verifyExternalApiKey(req: Request): boolean {
  const expected = process.env.EXTERNAL_API_KEY
  if (!expected) return false
  const provided = req.headers.get('x-api-key')
  if (!provided) return false
  if (provided.length !== expected.length) return false
  try {
    return timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
  } catch {
    return false
  }
}

/**
 * Verify an HMAC-SHA256 signature against `<timestamp>.<body>` (Stripe-style
 * signing scheme). Used by inbound Make.com / partner webhooks (M2 #9 / #10).
 *
 * Caller passes the raw request body as text (via `await req.text()`),
 * the timestamp from the `x-listd-timestamp` header, and the hex signature
 * from the `x-listd-signature` header. The secret comes from env.
 *
 * Returns one of:
 *   - `{ ok: true }` — signature valid AND timestamp within
 *     WEBHOOK_REPLAY_WINDOW_SECONDS of now
 *   - `{ ok: false, reason }` — explicit rejection reason for logging
 *
 * Matches the verification semantics expected by Make.com's "Custom webhook"
 * scenario when configured with HMAC-SHA256 signing.
 */
export type SignedWebhookResult =
  | { ok: true }
  | { ok: false; reason: 'missing_secret' | 'missing_headers' | 'expired' | 'bad_signature' }

export function verifySignedWebhook(
  rawBody: string,
  timestampHeader: string | null,
  signatureHeader: string | null,
  secret: string | undefined,
  windowSeconds = WEBHOOK_REPLAY_WINDOW_SECONDS
): SignedWebhookResult {
  if (!secret) return { ok: false, reason: 'missing_secret' }
  if (!timestampHeader || !signatureHeader) {
    return { ok: false, reason: 'missing_headers' }
  }

  const ts = Number.parseInt(timestampHeader, 10)
  if (!Number.isFinite(ts)) return { ok: false, reason: 'missing_headers' }
  const nowSec = Math.floor(Date.now() / 1000)
  if (Math.abs(nowSec - ts) > windowSeconds) {
    return { ok: false, reason: 'expired' }
  }

  const expected = createHmac('sha256', secret)
    .update(`${timestampHeader}.${rawBody}`)
    .digest('hex')

  if (signatureHeader.length !== expected.length) {
    return { ok: false, reason: 'bad_signature' }
  }
  try {
    const equal = timingSafeEqual(
      Buffer.from(signatureHeader),
      Buffer.from(expected)
    )
    return equal ? { ok: true } : { ok: false, reason: 'bad_signature' }
  } catch {
    return { ok: false, reason: 'bad_signature' }
  }
}

/**
 * Verify a Resend webhook (Svix signing scheme).
 *
 * Resend sends three headers:
 *   - `svix-id`         — message UUID (also used for idempotency)
 *   - `svix-timestamp`  — unix seconds
 *   - `svix-signature`  — space-separated `v1,<base64>` entries (multiple keys
 *                         supported during rotation)
 *
 * Signed payload is `${id}.${timestamp}.${body}`, HMAC-SHA256, secret is the
 * Svix endpoint secret (prefixed with `whsec_` — strip the prefix and base64-
 * decode for the HMAC key).
 */
export type ResendWebhookResult =
  | { ok: true; svixId: string }
  | { ok: false; reason: 'missing_secret' | 'missing_headers' | 'expired' | 'bad_signature' }

export function verifyResendWebhook(
  rawBody: string,
  headers: Headers,
  secret: string | undefined,
  windowSeconds = WEBHOOK_REPLAY_WINDOW_SECONDS
): ResendWebhookResult {
  if (!secret) return { ok: false, reason: 'missing_secret' }

  const svixId = headers.get('svix-id')
  const svixTimestamp = headers.get('svix-timestamp')
  const svixSignature = headers.get('svix-signature')
  if (!svixId || !svixTimestamp || !svixSignature) {
    return { ok: false, reason: 'missing_headers' }
  }

  const ts = Number.parseInt(svixTimestamp, 10)
  if (!Number.isFinite(ts)) return { ok: false, reason: 'missing_headers' }
  const nowSec = Math.floor(Date.now() / 1000)
  if (Math.abs(nowSec - ts) > windowSeconds) {
    return { ok: false, reason: 'expired' }
  }

  const keyBase64 = secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : secret
  const key = Buffer.from(keyBase64, 'base64')
  const expectedB64 = createHmac('sha256', key)
    .update(`${svixId}.${svixTimestamp}.${rawBody}`)
    .digest('base64')

  // The header is a space-separated list like "v1,abc v1,def" supporting
  // dual signing during key rotation. Accept the message if any one matches.
  const candidates = svixSignature.split(' ')
  for (const entry of candidates) {
    const [version, sig] = entry.split(',', 2)
    if (version !== 'v1' || !sig) continue
    if (sig.length !== expectedB64.length) continue
    try {
      if (timingSafeEqual(Buffer.from(sig), Buffer.from(expectedB64))) {
        return { ok: true, svixId }
      }
    } catch {
      // Length mismatch — fall through to next candidate.
    }
  }
  return { ok: false, reason: 'bad_signature' }
}
