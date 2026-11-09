#!/usr/bin/env node
/**
 * Create (or promote) an admin user.
 *
 * Does three things, idempotently, via the service-role Supabase client:
 *   1. Creates the auth user (email pre-confirmed so they can log in
 *      immediately). If the email already exists, finds it instead and
 *      leaves the existing password untouched.
 *   2. Upserts a `profiles` row with onboarding marked complete (admins
 *      skip the onboarding flow).
 *   3. Inserts the `admin` row into `user_roles` (no-op if already there).
 *
 * Usage (Node 20.6+ for --env-file):
 *
 *   node --env-file=.env.local scripts/create-admin.mjs <email> <password> "<Full Name>"
 *
 * Examples:
 *   node --env-file=.env.local scripts/create-admin.mjs ada@listd.pro 's3cret-pw' "Ada Lovelace"
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in the
 * env (both live in .env.local). The service-role key bypasses RLS, which
 * is why this is a server-side script and NOT something the app exposes.
 *
 * SAFETY: this grants full admin access. Run it deliberately, never wire
 * it into a request handler, and rotate the service-role key if it ever
 * leaks. Keep the password out of your shell history (most shells skip
 * history for commands prefixed with a space).
 */
import { createClient } from '@supabase/supabase-js'

function fail(msg) {
  console.error(`\n[create-admin] ✗ ${msg}\n`)
  process.exit(1)
}

// ── Parse + validate args ──────────────────────────────────────────
const [, , email, password, ...nameParts] = process.argv
const fullName = nameParts.join(' ').trim()

if (!email || !password) {
  fail(
    'Usage: node --env-file=.env.local scripts/create-admin.mjs <email> <password> "<Full Name>"'
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
  email_confirm: true, // skip the confirmation email — log in straight away
  user_metadata: { full_name: fullName || null },
})

if (createErr) {
  // Most likely cause: the email is already registered. Fall back to a
  // paginated lookup (the admin API has no get-by-email). We do NOT
  // reset the existing user's password — we only ensure they're an admin.
  const alreadyExists =
    /already.*registered|already.*exists|duplicate/i.test(createErr.message)
  if (!alreadyExists) {
    fail(`Failed to create auth user: ${createErr.message}`)
  }
  console.info(
    `[create-admin] user ${email} already exists — promoting to admin (password unchanged)`
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
  console.info(`[create-admin] created auth user ${email} (${userId})`)
}

// ── 2. Upsert the profile ──────────────────────────────────────────
// onConflict on user_id (profiles_user_id_key). Admins skip onboarding,
// so onboarding_completed = true.
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
console.info('[create-admin] profile row ready')

// ── 3. Grant the admin role ────────────────────────────────────────
// Unique on (user_id, role); ignoreDuplicates makes the re-run a no-op.
const { error: roleErr } = await supabase
  .from('user_roles')
  .upsert(
    { user_id: userId, role: 'admin' },
    { onConflict: 'user_id,role', ignoreDuplicates: true }
  )
if (roleErr) {
  fail(`Failed to grant admin role: ${roleErr.message}`)
}
console.info('[create-admin] admin role granted')

console.info(
  `\n[create-admin] ✓ ${createdFresh ? 'Created' : 'Promoted'} admin: ${email}` +
    `\n               user_id: ${userId}` +
    `\n               sign in at your desktop app's /auth (or /login) page.\n`
)
process.exit(0)

// ── helpers ─────────────────────────────────────────────────────────

/**
 * The Supabase admin API has no get-user-by-email, so we page through
 * listUsers. 1000 per page covers any realistic LISTD user base in one
 * call; we paginate defensively in case it grows.
 */
async function findUserIdByEmail(targetEmail) {
  const lower = targetEmail.toLowerCase()
  let page = 1
  // Cap at 10 pages (10k users) so a bug can't loop forever.
  while (page <= 10) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage: 1000,
    })
    if (error) fail(`listUsers failed: ${error.message}`)
    const match = data.users.find((u) => u.email?.toLowerCase() === lower)
    if (match) return match.id
    if (data.users.length < 1000) break // last page
    page += 1
  }
  return null
}
