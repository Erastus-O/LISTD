import 'server-only'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as tables from './schema/schema'
import * as relations from './schema/relations'
import type { Session } from '@/lib/dal'

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is not set')

// Pool sizing:
//   - **Dev / runtime (default):** `max: 10`. A single Node process serving
//     SSR pages routinely fires 3–5 parallel queries per request (DAL session
//     + layout fetches + bell popover + page data). `max: 3` saturated and
//     made trivial queries time out after 8s waiting for a slot.
//   - **`next build`:** Next spawns multiple worker processes — each with
//     its own postgres-js client. With the Supabase pooler capped at 15, ten
//     workers × max:10 would blow past it. Set `DATABASE_POOL_MAX=3` (or
//     similar) in the build env to clamp it back down.
//
// `prepare: false` is required for pgBouncer transaction-mode pooling.
// `connect_timeout: 10` short-circuits the kernel's default ~75s TCP retry
// so dev pages fail fast when the pooler is unreachable.
// `idle_timeout: 20` evicts stale sockets the pooler may have already torn
// down on its side (common with Supavisor in eu-west-2 after brief network
// blips) before drizzle picks them back up for the next query.
const poolMaxEnv = Number.parseInt(process.env.DATABASE_POOL_MAX ?? '', 10)
const poolMax = Number.isFinite(poolMaxEnv) && poolMaxEnv > 0 ? poolMaxEnv : 10

const client = postgres(url, {
  prepare: false,
  max: poolMax,
  connect_timeout: 10,
  idle_timeout: 20,
})

export const db = drizzle(client, {
  schema: { ...tables, ...relations },
})
export type DB = typeof db
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

export * from './schema/schema'

/**
 * Run `fn` inside a transaction with Postgres role and JWT claims set so
 * the existing 117 RLS policies fire (defence-in-depth per ADR-001).
 *
 * Use this for ALL user-facing data access in route handlers and server
 * actions. Even if the DAL has already verified the user's role, RLS gives
 * Postgres the final say on what rows are returned/modified.
 */
export async function withRLS<T>(
  session: Session,
  fn: (tx: Tx) => Promise<T>
): Promise<T> {
  const claims = JSON.stringify({
    sub: session.userId,
    role: 'authenticated',
    email: session.email,
  })

  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('role', 'authenticated', true)`)
    await tx.execute(sql`select set_config('request.jwt.claims', ${claims}, true)`)
    return fn(tx)
  })
}

/**
 * Run `fn` with the privileged Postgres role (RLS bypassed).
 *
 * Permitted callers per ADR-001:
 *   - Webhook handlers (signature already verified)
 *   - Vercel Cron handlers (CRON_SECRET already verified)
 *   - Admin operations needing cross-tenant visibility (after `requireRole('admin')`)
 *   - Drizzle migrations / bootstrap
 *
 * Always include a comment at the call site explaining why RLS is bypassed.
 */
export async function withServiceRole<T>(
  fn: (tx: Tx) => Promise<T>
): Promise<T> {
  return db.transaction(async (tx) => fn(tx))
}
