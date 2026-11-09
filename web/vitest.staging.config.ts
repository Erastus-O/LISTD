import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { parseEnv } from 'node:util'
import { defineConfig } from 'vitest/config'

// Integration tests against a real database: npm run test:staging
// Only the database URL is loaded, so no Stripe, email or SMS keys exist in these
// runs and nothing can leave the machine.
//
// Uses TEST_DATABASE_URL (a Neon database) from ../.env.local when set. The app's
// Supabase project needs ALLOW_TESTS_ON_APP_DB=1, because these tests create and
// delete rows: never set it once that project holds real customers.
const envFile = resolve(__dirname, '../.env.local')
const file = existsSync(envFile) ? parseEnv(readFileSync(envFile, 'utf8')) : {}
const testUrl = file.TEST_DATABASE_URL
let url: string
if (testUrl && new URL(testUrl).hostname.endsWith('.neon.tech')) {
  url = testUrl
} else if (process.env.ALLOW_TESTS_ON_APP_DB === '1') {
  url = createRequire(import.meta.url)('./scripts/supabase/env.cjs').loadAppEnv().DATABASE_URL
} else {
  throw new Error('test:staging needs a Neon TEST_DATABASE_URL in ../.env.local, or ALLOW_TESTS_ON_APP_DB=1')
}

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      'server-only': resolve(__dirname, './src/test/server-only-stub.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.staging.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 180_000,
    // One connection's worth of shared data: run files one at a time.
    fileParallelism: false,
    env: {
      DATABASE_URL: url,
      DATABASE_POOL_MAX: '3',
      STRIPE_SECRET_KEY: '',
      RESEND_API_KEY: '',
      TWILIO_ACCOUNT_SID: '',
    },
  },
})
