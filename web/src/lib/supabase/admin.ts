import 'server-only'
import { createClient } from '@supabase/supabase-js'

let _admin: ReturnType<typeof createClient> | null = null

/**
 * Service-role Supabase client for admin operations:
 *   - `auth.admin.*` (listUsers, generateLink, etc.)
 *   - tables when full RLS bypass is intentional and authorized at a higher layer
 *
 * Lazily initialised so `next build` doesn't fail when SUPABASE_SERVICE_ROLE_KEY
 * is still a TODO in `.env.local`.
 */
export function getSupabaseAdmin() {
  if (_admin) return _admin
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL is not set')
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set')
  _admin = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  return _admin
}
