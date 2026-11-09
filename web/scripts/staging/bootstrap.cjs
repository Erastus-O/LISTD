// Builds or updates the Neon staging database from src/db/migrations.
//
//   npm run staging:db
//
// Reads DATABASE_URL from the repo-root .env.local (or the environment).
// Refuses any host that isn't Neon: production is Supabase and its schema is
// changed deliberately at cutover, never by this script.
//
// Production migrations assume Supabase (auth.uid(), storage.objects, the
// authenticated role). Neon is plain Postgres, so compat.sql adds just enough
// of those for the migrations and RLS policies to apply unchanged.
//
// The 0000 baseline also relies on functions and triggers that predate the
// migrations. legacy-functions.sql and legacy-triggers.sql come from the old
// repo's supabase-export. They're a snapshot from April 2026, so production may
// have since changed them.
const { parseEnv } = require('node:util')
const { existsSync, readFileSync, readdirSync } = require('node:fs')
const path = require('node:path')
const postgres = require('postgres')

const web = path.resolve(__dirname, '../..')
const envFile = path.resolve(web, '../.env.local')
const url =
  process.env.STAGING_DATABASE_URL ??
  (existsSync(envFile) ? parseEnv(readFileSync(envFile, 'utf8')).DATABASE_URL : undefined)

if (!url) throw new Error('No staging DATABASE_URL found')
const host = new URL(url).hostname
if (!host.endsWith('.neon.tech')) {
  throw new Error(`Refusing to run: ${host} is not a Neon staging host`)
}

const dir = path.join(web, 'src/db/migrations')

// 0000 is an introspection baseline drizzle wrote inside a block comment.
function loadMigration(file) {
  let sqlText = readFileSync(path.join(dir, file), 'utf8')
  if (file.startsWith('0000_')) {
    sqlText = sqlText.replace(/^[\s\S]*?\/\*/, '').replace(/\*\/\s*$/, '')
  }
  return sqlText
}

// Types, then functions (policies call them), then tables and policies, then triggers.
async function applyBaseline(tx, text) {
  const parts = text.split('--> statement-breakpoint').map((p) => p.trim()).filter(Boolean)
  const isType = (p) => /^CREATE TYPE/i.test(p)
  for (const p of parts.filter(isType)) await tx.unsafe(p)
  await tx.unsafe('SET LOCAL check_function_bodies = off')
  await tx.unsafe(readFileSync(path.join(__dirname, 'legacy-functions.sql'), 'utf8'))
  for (const p of parts.filter((x) => !isType(x))) await tx.unsafe(p)
  await tx.unsafe(readFileSync(path.join(__dirname, 'legacy-triggers.sql'), 'utf8'))
}

async function main() {
  const sql = postgres(url, { max: 1, connect_timeout: 20, onnotice: () => {} })
  console.log(`Staging host: ${host}`)
  await sql.unsafe(readFileSync(path.join(__dirname, 'compat.sql'), 'utf8'))
  await sql`create table if not exists public._staging_migrations (name text primary key, applied_at timestamptz not null default now())`
  const done = new Set((await sql`select name from public._staging_migrations`).map((r) => r.name))

  const files = readdirSync(dir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort()
  let applied = 0
  for (const file of files) {
    if (done.has(file)) continue
    try {
      await sql.begin(async (tx) => {
        if (file.startsWith('0000_')) await applyBaseline(tx, loadMigration(file))
        else await tx.unsafe(loadMigration(file))
        await tx`insert into public._staging_migrations (name) values (${file})`
      })
      applied++
      console.log(`  applied ${file}`)
    } catch (err) {
      console.error(`FAILED ${file}: ${err.message}`)
      if (err.position) {
        const text = loadMigration(file)
        console.error(`  near: ${text.slice(Math.max(0, err.position - 120), Number(err.position) + 120)}`)
      }
      await sql.end()
      process.exit(1)
    }
  }
  await sql.unsafe(readFileSync(path.join(__dirname, 'dashboard-migrations.sql'), 'utf8'))
  const [{ n }] = await sql`select count(*)::int n from information_schema.tables where table_schema = 'public'`
  console.log(`Done: ${applied} applied, ${files.length} total, ${n} public tables`)
  await sql.end()
}

main().catch((err) => {
  console.error(err.message)
  process.exit(1)
})
