#!/usr/bin/env node
/**
 * Create (or promote) a MARKETING user — the SEO agency's restricted seat.
 *
 * Marketing users can sign in and reach exactly ONE admin surface:
 * /admin/seo (per-page meta title/description editing). Every other admin
 * page and API rejects the role, and post-signin routes them straight to
 * the SEO editor.
 *
 * Usage (Node 20.6+ for --env-file):
 *
 *   node --env-file=.env.local scripts/create-marketing-user.mjs <email> <password> "<Full Name>"
 *
 * Example:
 *   node --env-file=.env.local scripts/create-marketing-user.mjs seo@cyphas.com 's3cret-pw' "Cyphas Solutions"
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in the env
 * (point them at the production project), and migration 0034 applied
 * (`ALTER TYPE app_role ADD VALUE 'marketing'`) — the role insert fails
 * otherwise. Prefix the command with a space to keep the password out of
 * shell history.
 */
import { createClient } from '@supabase/supabase-js'

function fail(msg) {
  console.error(`\n[create-marketing-user] ✗ ${msg}\n`)
  process.exit(1)
}

// ── Parse + validate args ──────────────────────────────────────────
const [, , email, password, ...nameParts] = process.argv
const fullName = nameParts.join(' ').trim()

if (!email || !password) {
  fail(
    'Usage: node --env-file=.env.local scripts/create-marketing-user.mjs <email> <password> "<Full Name>"'
  )
}
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  fail(`"${email}" doesn't look like a valid email address`)
}
if (password.length < 8) {
  fail('Password must be at least 8 characters')
}

// ── Env ─────────────────────────────────────────────────────────────
const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url) {
  fail('NEXT_PUBLIC_SUPABASE_URL is not set — did you pass --env-file=.env.local?')
}
if (!key) {
  fail('SUPABASE_SERVICE_ROLE_KEY is not set — did you pass --env-file=.env.local?')
}

const supabase = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// ── 1. Find-or-create the auth user ────────────────────────────────
let userId
let createdFresh = false

const { data: created, error: createErr } = await supabase.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
  user_metadata: { full_name: fullName || null },
})

if (createErr) {
  const alreadyExists =
    /already.*registered|already.*exists|duplicate/i.test(createErr.message)
  if (!alreadyExists) {
    fail(`Failed to create auth user: ${createErr.message}`)
  }
  console.info(
    `[create-marketing-user] ${email} already exists — granting the marketing role (password unchanged)`
  )
  userId = await findUserIdByEmail(email)
  if (!userId) {
    fail(
      `createUser said ${email} exists but it wasn't found in listUsers — check the Supabase Auth dashboard manually`
    )
  }
} else {
  userId = created.user.id
  createdFresh = true
  console.info(`[create-marketing-user] created auth user ${email} (${userId})`)
}

// ── 2. Upsert the profile ──────────────────────────────────────────
const profileRow = {
  user_id: userId,
  onboarding_completed: true,
}
if (fullName) profileRow.full_name = fullName

const { error: profileErr } = await supabase
  .from('profiles')
  .upsert(profileRow, { onConflict: 'user_id' })
if (profileErr) {
  fail(`Failed to upsert profile: ${profileErr.message}`)
}
console.info('[create-marketing-user] profile row ready')

// ── 3. Grant the marketing role ────────────────────────────────────
const { error: roleErr } = await supabase
  .from('user_roles')
  .upsert(
    { user_id: userId, role: 'marketing' },
    { onConflict: 'user_id,role', ignoreDuplicates: true }
  )
if (roleErr) {
  if (/invalid input value for enum/i.test(roleErr.message)) {
    fail(
      "The 'marketing' role doesn't exist in this database yet — apply migration 0034_marketing_role.sql first."
    )
  }
  fail(`Failed to grant marketing role: ${roleErr.message}`)
}
console.info('[create-marketing-user] marketing role granted')

console.info(
  `\n[create-marketing-user] ✓ ${createdFresh ? 'Created' : 'Promoted'} marketing user: ${email}` +
    `\n               user_id: ${userId}` +
    `\n               They sign in at /auth and land on /admin/seo.` +
    `\n               That editor (and Help) is ALL this role can access.\n`
)
process.exit(0)

// ── helpers ─────────────────────────────────────────────────────────
async function findUserIdByEmail(targetEmail) {
  const lower = targetEmail.toLowerCase()
  let page = 1
  while (page <= 10) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage: 1000,
    })
    if (error) fail(`listUsers failed: ${error.message}`)
    const match = data.users.find((u) => u.email?.toLowerCase() === lower)
    if (match) return match.id
    if (data.users.length < 1000) break
    page += 1
  }
  return null
}
