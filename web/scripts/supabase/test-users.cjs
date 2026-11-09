// One test account per role, for checking the app by hand:
//   node scripts/supabase/test-users.cjs add      creates them
//   node scripts/supabase/test-users.cjs remove   deletes them and their data
//
// Passwords are generated and saved to ../.env.test-users.local (git-ignored),
// never printed. Emails use a reserved domain, so no message can reach anyone.
// Remove these accounts before the project goes live.
const { randomBytes } = require('node:crypto')
const { existsSync, readFileSync, rmSync, writeFileSync } = require('node:fs')
const { parseEnv } = require('node:util')
const path = require('node:path')
const { loadAppEnv, web } = require('./env.cjs')
const { createClient } = require(path.join(web, 'node_modules/@supabase/supabase-js'))
const postgres = require(path.join(web, 'node_modules/postgres'))

const env = loadAppEnv()
const ROLES = ['admin', 'client', 'clerk', 'cleaner', 'trades']
const DOMAIN = 'listd-test.invalid'
const file = path.resolve(web, '../.env.test-users.local')

async function add() {
  const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const saved = existsSync(file) ? parseEnv(readFileSync(file, 'utf8')) : {}
  for (const role of ROLES) {
    const email = `test-${role}@${DOMAIN}`
    const key = `TEST_${role.toUpperCase()}_PASSWORD`
    if (saved[key]) {
      console.log(`${role}: already set up`)
      continue
    }
    const password = randomBytes(18).toString('base64url')
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: `Test ${role}`, role },
    })
    if (error) throw new Error(`${role}: ${error.message}`)
    const id = data.user.id
    const profile = await supabase
      .from('profiles')
      .upsert({ user_id: id, full_name: `Test ${role}`, onboarding_completed: true }, { onConflict: 'user_id' })
    if (profile.error) throw new Error(`${role} profile: ${profile.error.message}`)
    const grant = await supabase.from('user_roles').insert({ user_id: id, role })
    if (grant.error) throw new Error(`${role} role: ${grant.error.message}`)
    saved[key] = password
    writeFileSync(file, Object.entries(saved).map(([k, v]) => `${k}=${v}`).join('\n') + '\n')
    console.log(`${role}: created ${email}`)
  }
}

async function remove() {
  const sql = postgres(env.DIRECT_URL, { max: 1, connect_timeout: 20, onnotice: () => {} })
  const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const owned = (await sql`select id from auth.users where email like ${`%@${DOMAIN}`}`).map((r) => r.id)
  // Files live under a folder named after the user. Storage must delete them itself.
  for (const bucket of ['avatars', 'clerk-documents', 'property-photos']) {
    for (const id of owned) {
      const { data } = await supabase.storage.from(bucket).list(id)
      const paths = (data ?? []).map((f) => `${id}/${f.name}`)
      if (paths.length) await supabase.storage.from(bucket).remove(paths)
    }
  }
  await sql.begin(async (tx) => {
    const ids = (await tx`select id from auth.users where email like ${`%@${DOMAIN}`}`).map((r) => r.id)
    if (!ids.length) return
    // Weekly-run records that paid nothing say nothing about real payouts.
    await tx`delete from public.payout_runs where paid_count = 0`
    await tx`delete from public.escrow_transactions where client_user_id = any(${ids})`
    await tx`delete from public.jobs where client_id = any(${ids})`
    await tx`delete from public.properties where client_id = any(${ids})`
    await tx`delete from public.organisation_members where user_id = any(${ids})`
    await tx`delete from public.organisations where created_by = any(${ids})`
    await tx`delete from public.user_roles where user_id = any(${ids})`
    await tx`delete from public.profiles where user_id = any(${ids})`
    await tx`delete from auth.users where id = any(${ids})`
    console.log(`Removed ${ids.length} test accounts`)
  })
  await sql.end()
  rmSync(file, { force: true })
}

const action = process.argv[2]
if (action !== 'add' && action !== 'remove') throw new Error('Use: add | remove')
;(action === 'add' ? add() : remove()).catch((err) => {
  console.error(err.message)
  process.exit(1)
})
