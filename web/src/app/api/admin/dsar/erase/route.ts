import { z } from 'zod'
import { badRequest, errorResponse, ok } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import { eraseSubjectData } from '@/lib/privacy/dsar'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const RequestSchema = z
  .object({
    userId: z.string().uuid().optional(),
    email: z.string().email().optional(),
    /** Hard guard — the caller must explicitly confirm an irreversible erasure. */
    confirm: z.literal(true),
    deletePhotos: z.boolean().optional(),
    anonymiseAuth: z.boolean().optional(),
  })
  .refine((b) => b.userId || b.email, {
    message: 'Provide userId and/or email',
  })

/**
 * POST /api/admin/dsar/erase — admin-only right-to-erasure. Anonymises the
 * subject's PII in place, deletes sensitive storage objects, anonymises the
 * Auth email, and audits the action. Financial / audit records are retained
 * (de-identified) under the legal-obligation basis.
 *
 * Irreversible — requires `confirm: true`.
 */
export async function POST(req: Request) {
  const session = await authorizeRequest('admin')
  if (session instanceof Response) return session

  try {
    const body = RequestSchema.parse(await req.json())

    const summary = await eraseSubjectData(
      { userId: body.userId ?? null, email: body.email ?? null },
      session.userId,
      {
        deletePhotos: body.deletePhotos,
        anonymiseAuth: body.anonymiseAuth,
      }
    )

    return ok({ success: true, summary })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return badRequest('Invalid request', err.flatten())
    }
    console.error('[admin/dsar/erase] error:', err)
    return errorResponse(err)
  }
}
