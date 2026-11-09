import { eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { errorResponse, ok } from '@/lib/api'
import { authorizeRequest, bustUserSession } from '@/lib/dal'
import { profiles, withServiceRole } from '@/db'

export const maxDuration = 15
export const runtime = 'nodejs'

const RequestSchema = z
  .object({
    fullName: z.string().trim().min(1).max(120),
    phone: z.string().trim().max(40).nullable().optional(),
    companyName: z.string().trim().max(160).nullable().optional(),
  })
  .strict()

/**
 * POST /api/client/profile — client saves their editable profile fields.
 * No audit row — this is non-state-transition profile maintenance,
 * symmetric with /api/clerk/profile and the admin notes handler.
 *
 * Organisation-level fields (billing address, VAT, company reg) live on
 * the `organisations` table and are admin-edited via a separate handler
 * when that surface ports.
 */
export async function POST(req: Request) {
  const session = await authorizeRequest('client', 'admin')
  if (session instanceof Response) return session

  try {
    const body = RequestSchema.parse(await req.json())

    await withServiceRole(async (tx) => {
      await tx
        .update(profiles)
        .set({
          fullName: body.fullName,
          phone: body.phone ?? null,
          companyName: body.companyName ?? null,
          updatedAt: sql`now()`,
        })
        .where(eq(profiles.userId, session.userId))
    })

    await bustUserSession(session.userId)
    return ok({ success: true })
  } catch (err) {
    console.error('[client/profile] error:', err)
    return errorResponse(err)
  }
}
