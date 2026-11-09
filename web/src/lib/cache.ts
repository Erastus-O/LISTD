import 'server-only'
import { Redis } from '@upstash/redis'

/**
 * Tiny Upstash wrapper for dashboard-KPI-style cache-aside reads.
 *
 * Why this exists: server components like `loadAdminDashboard` run a
 * dozen aggregation queries inside one transaction on every admin
 * navigation. Most of those numbers don't move per-second — caching
 * them for a minute drops the Postgres roundtrip count by an order
 * of magnitude during a busy admin session.
 *
 * Design rules:
 *   - **Degrades to pass-through.** If no Upstash credentials are set
 *     (local dev without an instance), `getOrSet` calls the loader
 *     every time. No errors, no warnings beyond a one-time boot log.
 *     Accepts either the Upstash-native env names
 *     (`UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`) or the
 *     Vercel-KV names the Upstash + Vercel integration creates
 *     (`KV_REST_API_URL` / `KV_REST_API_TOKEN`). The integration also
 *     writes a read-only token and a raw redis:// URL alongside; we
 *     only use the REST pair.
 *   - **Tolerates Redis being down.** Any thrown error from Redis is
 *     swallowed and the loader runs. A Redis outage degrades the app
 *     to uncached latency, never to downtime.
 *   - **JSON-shaped values only.** The dashboard payloads are already
 *     plain data. Don't try to cache class instances or Drizzle row
 *     types that contain Dates — `@upstash/redis` will stringify
 *     them, but parsing back gives strings, not Dates. Stick to
 *     primitives + ISO strings.
 *   - **Pure TTL invalidation.** No tag-based busting yet. If you
 *     write a row that should immediately reflect on a cached
 *     dashboard, either accept the TTL lag or call `bust(key)` after
 *     the write. We'll layer in tag invalidation if real staleness
 *     pain shows up.
 *
 * Key shape: `listd:<scope>:<rest>` — scope keeps multiple loaders
 * from accidentally colliding. See `cacheKey()` for the recommended
 * builder. Both the desktop and mobile workspaces share one Upstash
 * project but cannot collide because every key starts with the loader
 * name.
 */

const PREFIX = 'listd:'

let _client: Redis | null | undefined
function client(): Redis | null {
  if (_client !== undefined) return _client
  // Try Upstash-native names first (manual setup), then the Vercel KV
  // names the Upstash + Vercel integration provisions automatically.
  const url =
    process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN
  if (!url || !token) {
    console.info('[cache] Upstash env not set : running in pass-through mode')
    _client = null
    return null
  }
  _client = new Redis({ url, token })
  return _client
}

/**
 * Cache-aside read. Looks up `key`; on hit returns the parsed value.
 * On miss (or any Redis error) runs `loader`, stores the result with
 * `ttlSeconds` TTL, and returns it.
 *
 * The cache write is fire-and-forget — we don't make the caller wait
 * for it. If the write fails, the next reader misses again. Cheap.
 *
 * Returns whatever `loader()` returns. Type safety is on you: the
 * cached JSON must round-trip back to `T` cleanly (no Dates,
 * functions, undefined values).
 */
export async function getOrSet<T>(
  key: string,
  ttlSeconds: number,
  loader: () => Promise<T>
): Promise<T> {
  const redis = client()
  const fullKey = `${PREFIX}${key}`

  if (redis) {
    try {
      const hit = await redis.get<T>(fullKey)
      if (hit !== null && hit !== undefined) return hit
    } catch (err) {
      // Redis-side miss; fall through to loader.
      console.warn(`[cache] read failed for ${key}:`, errMsg(err))
    }
  }

  const fresh = await loader()

  if (redis) {
    // Fire-and-forget; the caller already has its value.
    redis.set(fullKey, fresh, { ex: ttlSeconds }).catch((err) => {
      console.warn(`[cache] write failed for ${key}:`, errMsg(err))
    })
  }

  return fresh
}

/**
 * Explicit cache bust. Use after writes that should immediately
 * reflect on a dashboard the user is about to revisit (e.g. after
 * a clerk accepts a job, bust `admin:dashboard` so the "pending
 * coverage" KPI is fresh on the admin's next view).
 *
 * No-op when Upstash is unconfigured.
 */
export async function bust(key: string): Promise<void> {
  const redis = client()
  if (!redis) return
  try {
    await redis.del(`${PREFIX}${key}`)
  } catch (err) {
    console.warn(`[cache] bust failed for ${key}:`, errMsg(err))
  }
}

/**
 * Convenience key builder so all loaders use the same shape:
 *   cacheKey('admin', 'dashboard')        → 'admin:dashboard'
 *   cacheKey('clerk', 'dashboard', userId) → 'clerk:dashboard:<uuid>'
 * The final string is then namespaced under `listd:` inside `getOrSet`.
 */
export function cacheKey(...parts: string[]): string {
  return parts.join(':')
}

/**
 * Raw read for callers that need the two-pass "check cache, then batch the
 * misses, then write back" pattern (the geocoder is the canonical example
 * — postcodes.io's bulk endpoint is far cheaper than 100 single lookups).
 * Returns `null` for both genuine misses and any Redis error so the caller
 * can treat both as "fetch this fresh". Pass-through-safe.
 */
export async function getRaw<T>(key: string): Promise<T | null> {
  const redis = client()
  if (!redis) return null
  try {
    const hit = await redis.get<T>(`${PREFIX}${key}`)
    return hit ?? null
  } catch (err) {
    console.warn(`[cache] getRaw failed for ${key}:`, errMsg(err))
    return null
  }
}

/**
 * Raw write. Pair with `getRaw` for the batch-write side of the two-pass
 * pattern. Fire-and-forget on the wire — caller doesn't wait for the
 * write to complete, and a failure logs and moves on.
 */
export async function setRaw<T>(
  key: string,
  value: T,
  ttlSeconds: number
): Promise<void> {
  const redis = client()
  if (!redis) return
  try {
    await redis.set(`${PREFIX}${key}`, value, { ex: ttlSeconds })
  } catch (err) {
    console.warn(`[cache] setRaw failed for ${key}:`, errMsg(err))
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * Idempotency claim. Atomically sets `key` to `1` with the given TTL only
 * if the key doesn't already exist. Returns `true` if this caller won the
 * claim (i.e. the work should proceed), `false` if another caller already
 * claimed it within the TTL window.
 *
 * Use at the top of any handler whose work must run exactly once per
 * external event id — Stripe webhooks, InventoryBase webhooks, Make
 * retries. The TTL should outlive the longest realistic retry window of
 * the source (Stripe retries for ~3 days, so use 86_400 * 3 there).
 *
 * Pass-through fallback: when Upstash is unconfigured, every call returns
 * `true` (the work runs every time). Existing DB-level idempotency
 * (unique constraints, atomic double-WHERE updates) is the safety net.
 *
 * Important: a `false` from this function means "drop this delivery and
 * return 200 to the sender so it stops retrying" — NOT "fail". Idempotency
 * is about silently absorbing duplicates, not surfacing them as errors.
 */
export async function tryClaim(
  key: string,
  ttlSeconds: number
): Promise<boolean> {
  const redis = client()
  if (!redis) return true // No cache: let the handler's DB-level guard catch dupes.

  try {
    // SET key 1 NX EX ttlSeconds — atomic in Redis. Returns 'OK' on first
    // claim, null when the key already exists.
    const result = await redis.set(`${PREFIX}${key}`, 1, {
      ex: ttlSeconds,
      nx: true,
    })
    return result === 'OK'
  } catch (err) {
    // Redis miss — assume not-yet-claimed and let the handler proceed.
    // The DB-level idempotency catches the duplicate if Redis is wrong.
    console.warn(`[cache] tryClaim failed for ${key}:`, errMsg(err))
    return true
  }
}

/**
 * Release an idempotency claim early. Useful when the work failed and you
 * want a retry to succeed instead of getting absorbed as a duplicate.
 *
 * Most webhook handlers should NOT call this — letting the TTL run out
 * naturally is the safe default; otherwise a malicious retry could keep
 * resetting the claim. Only release when you control both the cache and
 * the retry source and you've explicitly rolled back the work.
 */
export async function releaseClaim(key: string): Promise<void> {
  return bust(key)
}
