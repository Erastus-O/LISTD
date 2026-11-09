import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { errorResponse, ok } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import {
  organisationMembers,
  organisations,
  withServiceRole,
  xeroConnections,
} from '@/db'

export const maxDuration = 15
export const runtime = 'nodejs'

const ChoiceSchema = z.discriminatedUnion('choice', [
  z.object({
    choice: z.literal('create'),
    name: z.string().trim().min(1).max(100),
    billingAddress: z.string().trim().min(1).max(500),
    companyRegNumber: z.string().trim().max(20).optional(),
    vatNumber: z.string().trim().max(20).optional(),
    logoUrl: z.string().url().max(500).optional(),
  }),
  z.object({ choice: z.literal('join') }),
  z.object({ choice: z.literal('individual') }),
])

/**
 * POST /api/onboarding/client/organisation — Step 2 of the 3-step client
 * onboarding (PRD §5.1, US-005).
 *
 * Three branches:
 *   - `create`: insert (or update if a Postgres trigger already auto-created
 *      one for this user) the organisation + add the caller as `owner`.
 *   - `join`: no-op; the user joins via an invite link in the existing
 *      [accept-invite](../../accept-invite) flow.
 *   - `individual`: no-op.
 */
export async function POST(req: Request) {
  const session = await authorizeRequest()
  if (session instanceof Response) return session

  try {
    const parsed = ChoiceSchema.parse(await req.json())

    if (parsed.choice !== 'create') {
      // Both `join` and `individual` advance the flow without writes here.
      return ok({ success: true, organisationId: null })
    }

    const { name, billingAddress, companyRegNumber, vatNumber, logoUrl } =
      parsed

    // Service-role bypass: writes are scoped to the authenticated caller and
    // their freshly-created org. RLS would also permit this, but service-role
    // matches the existing onboarding/init handler pattern.
    const organisationId = await withServiceRole(async (tx) => {
      // Was an org already auto-created for this user (e.g. by a signup
      // trigger)? Find it via membership and update in-place.
      const [existing] = await tx
        .select({ organisationId: organisationMembers.organisationId })
        .from(organisationMembers)
        .where(
          and(
            eq(organisationMembers.userId, session.userId),
            eq(organisationMembers.status, 'active')
          )
        )
        .limit(1)

      if (existing?.organisationId) {
        await tx
          .update(organisations)
          .set({
            name,
            billingAddress,
            companyRegNumber: companyRegNumber || null,
            vatNumber: vatNumber || null,
            logoUrl: logoUrl || null,
          })
          .where(eq(organisations.id, existing.organisationId))
        return existing.organisationId
      }

      const [created] = await tx
        .insert(organisations)
        .values({
          name,
          createdBy: session.userId,
          billingAddress,
          companyRegNumber: companyRegNumber || null,
          vatNumber: vatNumber || null,
          logoUrl: logoUrl || null,
        })
        .returning({ id: organisations.id })

      await tx.insert(organisationMembers).values({
        organisationId: created.id,
        userId: session.userId,
        orgRole: 'owner',
        status: 'active',
      })

      return created.id
    })

    // M2 #4: best-effort Xero contact sync after a successful create. We
    // only fire when the caller already has a Xero connection — most users
    // won't, and we don't want onboarding to depend on Xero being live.
    // Errors are swallowed: contact sync failures should not block the
    // user from completing onboarding.
    void syncXeroContactBestEffort(session.userId, req).catch((err) => {
      console.warn(
        '[onboarding/organisation] post-create Xero sync skipped:',
        err instanceof Error ? err.message : err
      )
    })

    return ok({ success: true, organisationId })
  } catch (err) {
    return errorResponse(err)
  }
}

/**
 * Fire-and-forget Xero contact sync for the org-creating user. Skips silently
 * when no Xero connection exists for the user — the dominant case during
 * early onboarding. The contacts handler enforces its own auth gate, so we
 * forward the cookie header to authenticate as the same session.
 */
async function syncXeroContactBestEffort(
  userId: string,
  req: Request
): Promise<void> {
  // Cheap pre-check: skip the HTTP call if no connection exists.
  const hasConnection = await withServiceRole(async (tx) => {
    const rows = await tx
      .select({ userId: xeroConnections.userId })
      .from(xeroConnections)
      .where(eq(xeroConnections.userId, userId))
      .limit(1)
    return rows.length > 0
  })
  if (!hasConnection) return

  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? new URL(req.url).origin
  const cookie = req.headers.get('cookie') ?? ''
  await fetch(`${origin}/api/xero/contacts/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ user_ids: [userId] }),
  })
}
