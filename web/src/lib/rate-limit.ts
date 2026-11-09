import 'server-only'

/**
 * Fixed-window rate limiter with a Vercel-KV-ready Upstash REST adapter and a
 * no-op fallback when KV isn't provisioned.
 *
 * **Design.** Counts are bucketed into fixed windows (`floor(now / window)`).
 * Per-bucket key shape: `rl:<scope>:<identifier>:<windowStart>`. The first
 * hit in a window calls `INCR` (returns 1) then `EXPIRE NX` to set the TTL;
 * subsequent hits in the same window only `INCR`. When the count exceeds
 * `limit`, `allowed: false` is returned along with `retryAfterSeconds`.
 *
 * Why fixed-window not strict sliding-window: simpler, one round-trip per
 * call, and the M3 #9 spec is "30 req/min/IP" — fixed minute buckets are
 * fine for that. If we later need precise sliding semantics we can swap in
 * a sorted-set ZADD/ZRANGE pattern; the public API stays the same.
 *
 * **Upstash REST mode.** Activated when *both* `KV_REST_API_URL` and
 * `KV_REST_API_TOKEN` (or the Upstash equivalents) are set. Calls Upstash's
 * pipeline endpoint with two commands per limiter invocation. Zero deps —
 * we don't pull `@vercel/kv` because the surface we need is small enough to
 * hand-roll, and avoiding the dep keeps the bundle slim until KV is wired
 * for real.
 *
 * **No-op fallback.** When env vars are absent, every call returns
 * `allowed: true` and a one-time `console.info` warns that rate limiting is
 * disabled. Lets the dev environment + initial deploys proceed without a
 * forced KV provision; flip to live mode by setting env vars and restarting.
 *
 * **Failure mode.** If a configured KV is unreachable mid-request, the
 * limiter logs the error and returns `allowed: true` (fail-open). The
 * tradeoff: we'd rather serve traffic than 503 the whole site if Upstash
 * has a blip. Set `failClosed: true` in opts for sensitive endpoints (e.g.
 * the token-rotation handler) to flip that to deny.
 */

export type RateLimitOptions = {
  /** Logical bucket name — e.g. `'tenant-portal'`, `'webhook-resend'`. */
  scope: string
  /** Caller identifier — usually IP address. Anonymous = `'anon'`. */
  identifier: string
  /** Max hits per window. */
  limit: number
  /** Window length in seconds. */
  windowSeconds: number
  /**
   * On KV unreachable: deny by default? Default false (fail-open). Set
   * true for sensitive endpoints where unavailability should not let
   * traffic through.
   */
  failClosed?: boolean
}

export type RateLimitResult = {
  allowed: boolean
  /** Hits seen in the current window after this call. -1 when the limiter is disabled. */
  count: number
  /** Remaining hits in the window. -1 when disabled. */
  remaining: number
  /** Seconds until the current window expires. 0 when disabled. */
  retryAfterSeconds: number
  /** True when no KV adapter is wired and the call is a pass-through. */
  disabled: boolean
}

const URL_KEYS = ['KV_REST_API_URL', 'UPSTASH_REDIS_REST_URL'] as const
const TOKEN_KEYS = ['KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_TOKEN'] as const

let warned = false

function pickEnv(keys: ReadonlyArray<string>): string | null {
  for (const k of keys) {
    const v = process.env[k]
    if (v && v.length > 0) return v
  }
  return null
}

function getConfig(): { url: string; token: string } | null {
  const url = pickEnv(URL_KEYS)
  const token = pickEnv(TOKEN_KEYS)
  if (!url || !token) return null
  return { url, token }
}

/**
 * Apply a rate limit. Always resolves — never throws.
 *
 * @example
 *   const verdict = await rateLimit({
 *     scope: 'tenant-portal',
 *     identifier: callerIp(req) ?? 'anon',
 *     limit: 30,
 *     windowSeconds: 60,
 *   })
 *   if (!verdict.allowed) {
 *     return new Response('Too many requests', {
 *       status: 429,
 *       headers: { 'retry-after': String(verdict.retryAfterSeconds) },
 *     })
 *   }
 */
export async function rateLimit(
  opts: RateLimitOptions
): Promise<RateLimitResult> {
  const config = getConfig()
  if (!config) {
    if (!warned) {
      console.info(
        '[rate-limit] disabled : KV_REST_API_URL/_TOKEN not set; all requests pass through'
      )
      warned = true
    }
    return {
      allowed: true,
      count: -1,
      remaining: -1,
      retryAfterSeconds: 0,
      disabled: true,
    }
  }

  const nowSec = Math.floor(Date.now() / 1000)
  const windowStart = Math.floor(nowSec / opts.windowSeconds) * opts.windowSeconds
  const key = `rl:${opts.scope}:${opts.identifier}:${windowStart}`
  const ttlSeconds = opts.windowSeconds

  try {
    // Pipeline two commands: INCR (counts the hit), EXPIRE NX (sets TTL on
    // first hit only — subsequent hits inside the window leave it alone).
    const res = await fetch(`${config.url}/pipeline`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([
        ['INCR', key],
        ['EXPIRE', key, ttlSeconds, 'NX'],
      ]),
      // Don't let a slow KV stall a request indefinitely. 1.5s is generous;
      // production p99 is typically < 50ms.
      signal: AbortSignal.timeout(1500),
    })

    if (!res.ok) {
      throw new Error(`Upstash REST ${res.status}: ${await res.text().catch(() => '<unreadable>')}`)
    }

    // Pipeline response shape: `[{ result: <value>, error?: string }, …]`.
    const json = (await res.json()) as Array<{ result?: number; error?: string }>
    const incrResult = json[0]?.result
    if (typeof incrResult !== 'number') {
      throw new Error(`Unexpected INCR result: ${JSON.stringify(json[0])}`)
    }

    const count = incrResult
    const remaining = Math.max(0, opts.limit - count)
    const retryAfterSeconds = Math.max(0, windowStart + opts.windowSeconds - nowSec)
    const allowed = count <= opts.limit

    return { allowed, count, remaining, retryAfterSeconds, disabled: false }
  } catch (err) {
    console.error('[rate-limit] KV call failed:', err)
    if (opts.failClosed) {
      return {
        allowed: false,
        count: -1,
        remaining: 0,
        retryAfterSeconds: opts.windowSeconds,
        disabled: false,
      }
    }
    // Fail-open default — better to serve than 503 the world.
    return {
      allowed: true,
      count: -1,
      remaining: -1,
      retryAfterSeconds: 0,
      disabled: false,
    }
  }
}

/**
 * Convenience wrapper that returns a `Response` ready to send when the
 * limit is breached, else `null` for the caller to continue. Pattern:
 *
 *   const limited = await rateLimitOrResponse({ scope: 'webhook-resend', identifier: ip, limit: 60, windowSeconds: 60 })
 *   if (limited) return limited
 *   // ...do work
 */
export async function rateLimitOrResponse(
  opts: RateLimitOptions
): Promise<Response | null> {
  const verdict = await rateLimit(opts)
  if (verdict.allowed) return null
  return new Response('Too many requests', {
    status: 429,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'retry-after': String(verdict.retryAfterSeconds || 1),
      'x-ratelimit-limit': String(opts.limit),
      'x-ratelimit-remaining': '0',
    },
  })
}
