import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEnvConfig } from '@next/env'
import { defineConfig } from 'drizzle-kit'

const projectDir = dirname(fileURLToPath(import.meta.url))
const result = loadEnvConfig(projectDir)

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL

if (!url) {
  console.error(
    'Loaded env files:',
    result.loadedEnvFiles?.map((f) => f.path) ?? 'none'
  )
  console.error(
    'Env keys matching DATABASE/DIRECT/SUPABASE:',
    Object.keys(process.env).filter((k) => /DATABASE|DIRECT|SUPABASE/.test(k))
  )
  throw new Error(
    'drizzle-kit needs DIRECT_URL (preferred) or DATABASE_URL set in .env.local. ' +
      'Use the direct or session pooler connection (port 5432) for pull/push/generate — ' +
      'the transaction pooler does not support DDL.'
  )
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/*',
  out: './src/db/migrations',
  dbCredentials: { url },
  schemaFilter: ['public'],
  verbose: true,
  strict: true,
})
