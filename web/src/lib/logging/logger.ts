import 'server-only'
import { appLogs, withServiceRole } from '@/db'

/**
 * Structured operational logging for troubleshooting.
 *
 * Three tiers:
 *   1. `console.*` → Vercel runtime logs (live tail, short retention).
 *   2. `app_logs` table → queryable + indexed (this module writes it).
 *   3. daily NDJSON rollups in the private `logs` bucket (the export-logs cron).
 *
 * Channels: `payment` (Stripe / escrow / payouts), `application` (notable app
 * events), `error` (caught failures). Logging is best-effort and NEVER throws
 * into the caller — a logging failure must not break the request it describes.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'
export type LogChannel = 'payment' | 'application' | 'error'

export type LogInput = {
  channel: LogChannel
  level?: LogLevel
  /** Short machine name, e.g. `escrow.released`, `webhook.received`. */
  event?: string
  message?: string
  context?: Record<string, unknown>
  requestId?: string | null
  actorUserId?: string | null
  route?: string | null
}

// Drop obvious secrets before anything is persisted or printed.
const SECRET_KEY = /(secret|token|password|authorization|api[_-]?key|signature|bearer)/i
function redact(ctx: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(ctx)) {
    out[k] = SECRET_KEY.test(k) ? '[redacted]' : v
  }
  return out
}

/**
 * Core writer. Emits a structured console line (tier 1) then persists a row
 * (tier 2). Both are wrapped so the logger never throws.
 */
export async function writeLog(input: LogInput): Promise<void> {
  const level: LogLevel =
    input.level ?? (input.channel === 'error' ? 'error' : 'info')
  const context = input.context ? redact(input.context) : {}

  const line = {
    channel: input.channel,
    level,
    event: input.event,
    message: input.message,
    ...context,
  }
  const sink =
    level === 'error'
      ? console.error
      : level === 'warn'
        ? console.warn
        : console.log
  try {
    sink(`[${input.channel}]`, JSON.stringify(line))
  } catch {
    /* console must never break the request */
  }

  try {
    await withServiceRole((tx) =>
      tx.insert(appLogs).values({
        level,
        channel: input.channel,
        event: input.event ?? null,
        message: input.message ?? null,
        context,
        requestId: input.requestId ?? null,
        actorUserId: input.actorUserId ?? null,
        route: input.route ?? null,
      })
    )
  } catch (err) {
    console.error('[logger] failed to persist log:', err)
  }
}

/** Payment-channel log (Stripe / escrow / payouts). */
export function logPayment(
  event: string,
  message: string,
  context?: Record<string, unknown>,
  opts?: Partial<LogInput>
): Promise<void> {
  return writeLog({
    channel: 'payment',
    level: 'info',
    event,
    message,
    context,
    ...opts,
  })
}

/** Application-channel log (notable lifecycle / operational events). */
export function logApp(
  event: string,
  message: string,
  context?: Record<string, unknown>,
  opts?: Partial<LogInput>
): Promise<void> {
  return writeLog({
    channel: 'application',
    level: 'info',
    event,
    message,
    context,
    ...opts,
  })
}

/** Error-channel log — pass the caught error; the stack is captured. */
export function logError(
  event: string,
  error: unknown,
  context?: Record<string, unknown>,
  opts?: Partial<LogInput>
): Promise<void> {
  const err =
    error instanceof Error
      ? { name: error.name, message: error.message, stack: error.stack }
      : { message: String(error) }
  return writeLog({
    channel: 'error',
    level: 'error',
    event,
    message: err.message,
    context: { ...context, error: err },
    ...opts,
  })
}
