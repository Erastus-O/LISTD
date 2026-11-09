// Runs a command against the app's Supabase project, using ../.env.local:
//   node scripts/supabase/with-env.cjs next dev -p 3100
//   node scripts/supabase/with-env.cjs scripts/create-admin.mjs <email> <password> "<Full Name>"
//
// Loads database, auth and storage settings only. No Stripe, email or SMS keys
// are set here, so a local run can't charge or message anyone.
const { spawn } = require('node:child_process')
const path = require('node:path')
const { loadAppEnv, web } = require('./env.cjs')

const file = loadAppEnv()
const [cmd, ...args] = process.argv.slice(2)
const child = spawn(process.execPath, [cmd.startsWith('scripts/') ? path.join(web, cmd) : path.join(web, 'node_modules', cmd === 'next' ? 'next/dist/bin/next' : cmd), ...args], {
  cwd: web,
  stdio: 'inherit',
  env: {
    ...process.env,
    DATABASE_URL: file.DATABASE_URL,
    DATABASE_POOL_MAX: '5',
    NEXT_PUBLIC_SUPABASE_URL: file.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: file.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    SUPABASE_SERVICE_ROLE_KEY: file.SUPABASE_SERVICE_ROLE_KEY,
    SUPABASE_JWKS_URL: file.SUPABASE_JWKS_URL,
    NEXT_PUBLIC_SITE_URL: file.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3100',
    CRON_SECRET: 'local-only',
  },
})
child.on('exit', (code) => process.exit(code ?? 0))
