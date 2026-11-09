// Builds or updates the app's Supabase project: npm run db:setup
//
//   1. Baseline: types, legacy functions, tables and policies, legacy triggers
//   2. src/db/migrations, in order
//   3. Objects production got by hand (dashboard-migrations.sql, sql/*.sql)
//   4. Buckets the hand-run scripts assume already exist
//   5. Security audit: RLS on every public table, and no unexpected public bucket
//
// Safe to re-run: applied files are tracked in public._app_migrations.
const { readFileSync, readdirSync } = require('node:fs')
const path = require('node:path')
const { loadAppEnv, web, APP_PROJECT_REF } = require('./env.cjs')
const postgres = require(path.join(web, 'node_modules/postgres'))

const env = loadAppEnv()
const dir = path.join(web, 'src/db/migrations')
const staging = path.join(web, 'scripts/staging')
const handRun = path.join(web, 'sql')

// Only these may be public. Each has a comment in sql/ explaining why.
const PUBLIC_BUCKETS = ['avatars', 'organisation-logos']
// The hand-run scripts add policies to these but don't create them.
const PRIVATE_BUCKETS = ['generated-reports', 'signatures']

function loadMigration(file) {
  let text = readFileSync(path.join(dir, file), 'utf8')
  // 0000 is an introspection baseline drizzle wrote inside a block comment.
  if (file.startsWith('0000_')) text = text.replace(/^[\s\S]*?\/\*/, '').replace(/\*\/\s*$/, '')
  return text
}

async function applyBaseline(tx, text) {
  const parts = text.split('--> statement-breakpoint').map((p) => p.trim()).filter(Boolean)
  const isType = (p) => /^CREATE TYPE/i.test(p)
  for (const p of parts.filter(isType)) await tx.unsafe(p)
  await tx.unsafe('SET LOCAL check_function_bodies = off')
  await tx.unsafe(readFileSync(path.join(staging, 'legacy-functions.sql'), 'utf8'))
  for (const p of parts.filter((x) => !isType(x))) await tx.unsafe(p)
  await tx.unsafe(readFileSync(path.join(staging, 'legacy-triggers.sql'), 'utf8'))
}

async function main() {
  const sql = postgres(env.DIRECT_URL, { max: 1, connect_timeout: 20, onnotice: () => {} })
  console.log(`Project: ${APP_PROJECT_REF}`)

  await sql`create table if not exists public._app_migrations (name text primary key, applied_at timestamptz not null default now())`
  await sql`alter table public._app_migrations enable row level security`
  const done = new Set((await sql`select name from public._app_migrations`).map((r) => r.name))

  async function apply(name, run) {
    if (done.has(name)) return false
    try {
      await sql.begin(async (tx) => {
        await run(tx)
        await tx`insert into public._app_migrations (name) values (${name})`
      })
      console.log(`  applied ${name}`)
      return true
    } catch (err) {
      console.error(`FAILED ${name}: ${err.code ?? ''} ${err.message}`)
      await sql.end()
      process.exit(1)
    }
  }

  const files = readdirSync(dir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort()
  for (const file of files) {
    await apply(file, async (tx) => {
      if (file.startsWith('0000_')) await applyBaseline(tx, loadMigration(file))
      else await tx.unsafe(loadMigration(file))
    })
  }
  await apply('dashboard-migrations.sql', (tx) =>
    tx.unsafe(readFileSync(path.join(staging, 'dashboard-migrations.sql'), 'utf8')),
  )

  await sql.begin(async (tx) => {
    for (const id of PRIVATE_BUCKETS) {
      await tx`insert into storage.buckets (id, name, public) values (${id}, ${id}, false) on conflict (id) do nothing`
    }
  })
  for (const file of readdirSync(handRun).filter((f) => f.endsWith('.sql')).sort()) {
    await apply(`sql/${file}`, (tx) => tx.unsafe(readFileSync(path.join(handRun, file), 'utf8')))
  }

  // Tables in public are reachable with the public key unless RLS is on. A table
  // with RLS and no policies is reachable only by the server, which is the safe
  // default for the few stand-ins that came without policies.
  const open = await sql`
    select c.relname t from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity order by 1`
  for (const { t } of open) {
    await sql.unsafe(`alter table public."${t}" enable row level security`)
    console.log(`  RLS enabled on ${t} (had none)`)
  }

  const buckets = await sql`select id, public from storage.buckets order by 1`
  const wronglyPublic = buckets.filter((b) => b.public && !PUBLIC_BUCKETS.includes(b.id))
  const [{ tables }] = await sql`select count(*)::int tables from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'`
  const [{ policies }] = await sql`select count(*)::int policies from pg_policies where schemaname in ('public', 'storage')`
  console.log(`Tables ${tables}, policies ${policies}`)
  console.log(`Buckets: ${buckets.map((b) => `${b.id}${b.public ? ' (public)' : ''}`).join(', ')}`)
  await sql.end()
  if (wronglyPublic.length) {
    console.error(`Unexpected public buckets: ${wronglyPublic.map((b) => b.id).join(', ')}`)
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(err.message)
  process.exit(1)
})
