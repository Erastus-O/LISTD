import { z } from 'zod'
import { errorResponse, ok } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import { findUsablePromo } from '@/lib/promo'

export const runtime = 'nodejs'

const RequestSchema = z.object({
  code: z.string().trim().min(1).max(40),
  /** ADMIN on-behalf booking: check assigned (private) codes against this
   *  client instead of the caller. Ignored for non-admins. */
  clientId: z.string().uuid().optional(),
})

/**
 * POST /api/promo/validate — booking-flow preview check. Returns the code's
 * shape (kind / percent / service scope) so the client can render the
 * discount line or the "pay at month end" notice before submitting. The
 * create routes re-validate and redeem authoritatively — nothing here is
 * trusted at charge time.
 */
export async function POST(req: Request) {
  const session = await authorizeRequest()
  if (session instanceof Response) return session

  try {
    const body = RequestSchema.parse(await req.json())
    const forClientId =
      body.clientId && session.roles.includes('admin')
        ? body.clientId
        : session.userId
    const lookup = await findUsablePromo(body.code, { forClientId })
    if (!lookup.ok) {
      return ok({ valid: false, error: lookup.error })
    }
    const { promo } = lookup
    return ok({
      valid: true,
      code: promo.code,
      kind: promo.kind,
      percentOff: promo.percentOff,
      serviceTypes: promo.serviceTypes ?? [],
    })
  } catch (err) {
    return errorResponse(err)
  }
}
