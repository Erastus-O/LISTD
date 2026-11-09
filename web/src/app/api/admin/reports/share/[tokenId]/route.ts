import { z } from 'zod'
import { errorResponse, noContent } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import { revokeShareToken } from '@/lib/report-share-tokens'

export const maxDuration = 10
export const runtime = 'nodejs'

const RequestSchema = z
  .object({
    reason: z.string().trim().max(500).nullable().optional(),
  })
  .strict()

type Params = { params: Promise<{ tokenId: string }> }

/**
 * DELETE /api/admin/reports/share/[tokenId] — revoke a share token by
 * its row id (not the raw token — admins manage by id from the listing
 * endpoint). Idempotent on already-revoked.
 */
export async function DELETE(req: Request, { params }: Params) {
  const session = await authorizeRequest('admin')
  if (session instanceof Response) return session

  try {
    const { tokenId } = await params
    let reason: string | null = null
    try {
      const body = RequestSchema.parse(await req.json().catch(() => ({})))
      reason = body.reason ?? null
    } catch {
      // Body is optional — empty body is fine.
    }
    await revokeShareToken({ tokenId, by: session.userId, reason })
    return noContent()
  } catch (err) {
    console.error('[admin/reports/share/:tokenId DELETE] error:', err)
    return errorResponse(err)
  }
}
