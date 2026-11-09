import { redirect } from 'next/navigation'
import { requireRole } from '@/lib/dal'

export const dynamic = 'force-dynamic'

/**
 * Worker settings are identical to client settings (profile, password,
 * notifications). We redirect to /client/settings rather than ship a
 * duplicate page; the client settings page accepts both `client` and
 * `admin` callers and the worker is a `client` Supabase role.
 */
export default async function WorkerSettingsRedirect() {
  await requireRole('client', 'admin')
  redirect('/client/settings')
}
