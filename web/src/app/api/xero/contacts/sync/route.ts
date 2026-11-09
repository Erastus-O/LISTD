import { inArray } from 'drizzle-orm'
import { z } from 'zod'
import { errorResponse, ok } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import { profiles, userRoles, withServiceRole } from '@/db'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import {
  XERO_API_BASE,
  fetchXeroWithRetry,
  getValidXeroAccess,
  xeroHeaders,
} from '@/lib/xero'

export const maxDuration = 60
export const runtime = 'nodejs'

const RequestSchema = z.object({
  user_ids: z.array(z.string().uuid()).min(1),
  /**
   * `force: true` overrides duplicate-name detection — any incoming user
   * whose email matches an existing Xero contact with a different `Name`
   * will be **updated** instead of skipped. Default false (M2 #4 spec).
   */
  force: z.boolean().optional(),
})

type SyncResult = {
  user_id: string
  name: string
  xero_contact_id?: string
  action: 'created' | 'updated' | 'skipped' | 'collision'
  error?: string
  collision?: {
    existing_name: string
    existing_contact_id: string
    incoming_name: string
  }
}

type XeroContact = {
  ContactID?: string
  Name?: string
  EmailAddress?: string
  ContactStatus?: string
}

/**
 * POST /api/xero/contacts/sync — bulk sync LISTD users into Xero contacts (M2 #4).
 *
 * Hardening over the M-Pre port:
 *   - **Retry / idempotency.** Every Xero call goes through
 *     [`fetchXeroWithRetry`](../../../../lib/xero.ts). Per-user idempotency
 *     keys (`xero:contact:<userId>:create` / `:update`) keep duplicates out
 *     of Xero on retries.
 *   - **Collision detection.** When an existing Xero contact already shares
 *     the incoming email but the Name differs, we **don't** silently
 *     overwrite — we return a `collision` result so the admin can decide
 *     (the legacy port did a blind update, which masked agency-vs-individual
 *     name swaps). Pass `force: true` in the body to override.
 */
export async function POST(req: Request) {
  const session = await authorizeRequest()
  if (session instanceof Response) return session

  try {
    const body = await req.json()
    const { user_ids, force } = RequestSchema.parse(body)

    // Service-role bypass: cross-user lookup of profiles + roles is admin-style
    // work. Authorization is via the route's `authorizeRequest()` boundary.
    const { profileRows, roleMap } = await withServiceRole(async (tx) => {
      const profileRows = await tx
        .select({
          userId: profiles.userId,
          fullName: profiles.fullName,
          phone: profiles.phone,
          companyName: profiles.companyName,
        })
        .from(profiles)
        .where(inArray(profiles.userId, user_ids))

      const roleRows = await tx
        .select({ userId: userRoles.userId, role: userRoles.role })
        .from(userRoles)
        .where(inArray(userRoles.userId, user_ids))

      const roleMap = new Map<string, string>()
      for (const r of roleRows) roleMap.set(r.userId, r.role)

      return { profileRows, roleMap }
    })

    if (profileRows.length === 0) {
      return Response.json(
        { error: 'No profiles found for given user_ids' },
        { status: 404 }
      )
    }

    // Resolve auth.users emails one shot (paginated up to 1000 — same as the
    // original which iterated `getUserById` per user).
    const admin = getSupabaseAdmin()
    const {
      data: { users },
      error: usersError,
    } = await admin.auth.admin.listUsers({ perPage: 1000 })
    if (usersError) throw usersError
    const emailById = new Map(
      users.filter((u) => u.email).map((u) => [u.id, u.email!])
    )

    const access = await getValidXeroAccess(session.userId)
    const results: SyncResult[] = []

    for (const profile of profileRows) {
      const email = emailById.get(profile.userId)
      const incomingName =
        profile.companyName ||
        profile.fullName ||
        email ||
        profile.userId
      // role is read but not currently sent to Xero (parity with original);
      // kept here so tagging can be added without another schema lookup.
      void roleMap.get(profile.userId)

      try {
        let existing: XeroContact | null = null
        if (email) {
          const where = encodeURIComponent(`EmailAddress=="${email}"`)
          const search = await fetchXeroWithRetry<{ Contacts?: XeroContact[] }>(
            `${XERO_API_BASE}/Contacts?where=${where}`,
            { headers: xeroHeaders(access) },
            access
          )
          if (search.ok) {
            existing = search.data.Contacts?.[0] ?? null
          }
        }

        // Collision: existing email match but a different Name on Xero side.
        if (existing && existing.Name && existing.Name !== incomingName && !force) {
          results.push({
            user_id: profile.userId,
            name: incomingName,
            xero_contact_id: existing.ContactID,
            action: 'collision',
            collision: {
              existing_name: existing.Name,
              existing_contact_id: existing.ContactID ?? '',
              incoming_name: incomingName,
            },
          })
          continue
        }

        const [firstName, ...rest] = (profile.fullName ?? '').split(' ')
        const contactPayload: Record<string, unknown> = {
          Name: incomingName,
          FirstName: firstName ?? '',
          LastName: rest.join(' '),
          EmailAddress: email ?? '',
          ContactStatus: 'ACTIVE',
          ContactGroups: [],
        }
        if (profile.phone) {
          contactPayload.Phones = [
            { PhoneType: 'MOBILE', PhoneNumber: profile.phone },
          ]
        }

        if (existing?.ContactID) {
          contactPayload.ContactID = existing.ContactID
          const updateRes = await fetchXeroWithRetry<{ Contacts?: XeroContact[] }>(
            `${XERO_API_BASE}/Contacts/${existing.ContactID}`,
            {
              method: 'POST',
              headers: xeroHeaders(access),
              body: JSON.stringify({ Contacts: [contactPayload] }),
            },
            access,
            { idempotencyKey: `xero:contact:${profile.userId}:update` }
          )
          if (updateRes.ok) {
            results.push({
              user_id: profile.userId,
              name: incomingName,
              xero_contact_id: existing.ContactID,
              action: 'updated',
            })
          } else {
            results.push({
              user_id: profile.userId,
              name: incomingName,
              action: 'skipped',
              error: stringifyError(updateRes.error),
            })
          }
        } else {
          const createRes = await fetchXeroWithRetry<{ Contacts?: XeroContact[] }>(
            `${XERO_API_BASE}/Contacts`,
            {
              method: 'POST',
              headers: xeroHeaders(access),
              body: JSON.stringify({ Contacts: [contactPayload] }),
            },
            access,
            { idempotencyKey: `xero:contact:${profile.userId}:create` }
          )
          if (createRes.ok) {
            results.push({
              user_id: profile.userId,
              name: incomingName,
              xero_contact_id: createRes.data.Contacts?.[0]?.ContactID,
              action: 'created',
            })
          } else {
            results.push({
              user_id: profile.userId,
              name: incomingName,
              action: 'skipped',
              error: stringifyError(createRes.error),
            })
          }
        }
      } catch (err) {
        results.push({
          user_id: profile.userId,
          name: incomingName,
          action: 'skipped',
          error: err instanceof Error ? err.message : 'Unknown error',
        })
      }
    }

    const summary = {
      created: results.filter((r) => r.action === 'created').length,
      updated: results.filter((r) => r.action === 'updated').length,
      skipped: results.filter((r) => r.action === 'skipped').length,
      collisions: results.filter((r) => r.action === 'collision').length,
      total: results.length,
    }

    return ok({ success: true, summary, results })
  } catch (err) {
    return errorResponse(err)
  }
}

function stringifyError(err: unknown): string {
  if (typeof err === 'string') return err
  try {
    return JSON.stringify(err)
  } catch {
    return String(err)
  }
}
