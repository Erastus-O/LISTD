import 'server-only'
import { eq } from 'drizzle-orm'
import { db, profiles } from '@/db'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import {
  XERO_API_BASE,
  fetchXeroWithRetry,
  xeroHeaders,
  type XeroAccess,
} from '@/lib/xero'

type LookupResult =
  | { ok: true; contactId: string; contactName: string }
  | { ok: false; error: string }

/**
 * Resolve a LISTD client (profiles row) to a Xero ContactID. Lookup is
 * deterministic on the client's email so repeated invoicing for the same
 * client always lands on the same Xero contact (no duplicates).
 *
 * Fallback chain:
 *   1. Search Xero by client's email — most reliable.
 *   2. If not found, POST a new contact with name + email + (optional) company.
 *
 * The result is **not** cached locally — Xero's contact id is the source
 * of truth. Adding a `profiles.xero_contact_id` column is a follow-up if
 * the per-create round-trip becomes a hotspot.
 */
export async function resolveXeroContact(
  clientId: string,
  access: XeroAccess
): Promise<LookupResult> {
  const [profile] = await db
    .select({
      fullName: profiles.fullName,
      companyName: profiles.companyName,
    })
    .from(profiles)
    .where(eq(profiles.userId, clientId))
    .limit(1)
  if (!profile) {
    return { ok: false, error: 'Client profile not found' }
  }

  // Email comes from auth.users — pull via admin client.
  let email: string | null = null
  try {
    const res = await getSupabaseAdmin().auth.admin.getUserById(clientId)
    email = res.data?.user?.email ?? null
  } catch {
    email = null
  }

  const displayName = profile.companyName ?? profile.fullName ?? 'LISTD Client'

  // ── 1. Search by email ─────────────────────────────────────────────
  if (email) {
    const escaped = email.replace(/"/g, '\\"')
    const searchUrl = `${XERO_API_BASE}/Contacts?where=${encodeURIComponent(`EmailAddress=="${escaped}"`)}`
    const search = await fetchXeroWithRetry<{
      Contacts?: Array<{ ContactID: string; Name: string }>
    }>(
      searchUrl,
      { method: 'GET', headers: xeroHeaders(access) },
      access
    )
    if (search.ok) {
      const found = search.data.Contacts?.[0]
      if (found?.ContactID) {
        return { ok: true, contactId: found.ContactID, contactName: found.Name }
      }
    }
  }

  // ── 2. Create ──────────────────────────────────────────────────────
  const createBody: Record<string, unknown> = { Name: displayName }
  if (profile.fullName && profile.companyName && profile.fullName !== displayName) {
    // Split first/last name from `fullName` so Xero's invoice template
    // can address the person, not just the company.
    const parts = profile.fullName.trim().split(/\s+/)
    createBody.FirstName = parts[0]
    if (parts.length > 1) createBody.LastName = parts.slice(1).join(' ')
  }
  if (email) createBody.EmailAddress = email

  const create = await fetchXeroWithRetry<{
    Contacts?: Array<{ ContactID: string; Name: string }>
  }>(
    `${XERO_API_BASE}/Contacts`,
    {
      method: 'POST',
      headers: xeroHeaders(access),
      body: JSON.stringify({ Contacts: [createBody] }),
    },
    access,
    { idempotencyKey: `contact:${clientId}` }
  )
  if (!create.ok) {
    return {
      ok: false,
      error: `Xero contact create failed: HTTP ${create.status}`,
    }
  }
  const created = create.data.Contacts?.[0]
  if (!created?.ContactID) {
    return { ok: false, error: 'Xero returned no contact id on create.' }
  }
  return { ok: true, contactId: created.ContactID, contactName: created.Name }
}
