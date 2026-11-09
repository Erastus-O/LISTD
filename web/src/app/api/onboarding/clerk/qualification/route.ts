import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { errorResponse, ok } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import { profiles, withServiceRole } from '@/db'

export const maxDuration = 10
export const runtime = 'nodejs'

/**
 * Stored as a single text column on `profiles.qualification`. We pack the
 * cert kind (ARLA, NFOPP, LISTD Academy…) and the file path in a single
 * pipe-delimited string: "<kind>|<storage_path>". Keeps the M1 schema
 * delta minimal; structured per-cert rows can come in M2 if needed.
 */
const RequestSchema = z
  .object({
    qualificationKind: z.enum([
      'arla',
      'nfopp',
      'listd_academy',
      'rics',
      'other',
    ]),
    qualificationUrl: z.string().min(1).max(500),
  })
  .strict()

export async function PATCH(req: Request) {
  const session = await authorizeRequest()
  if (session instanceof Response) return session

  try {
    const { qualificationKind, qualificationUrl } = RequestSchema.parse(
      await req.json()
    )

    await withServiceRole(async (tx) =>
      tx
        .update(profiles)
        .set({ qualification: `${qualificationKind}|${qualificationUrl}` })
        .where(eq(profiles.userId, session.userId))
    )

    return ok({ success: true })
  } catch (err) {
    return errorResponse(err)
  }
}
