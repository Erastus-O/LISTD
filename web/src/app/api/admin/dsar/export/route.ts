import { badRequest, errorResponse } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import { exportSubjectData } from '@/lib/privacy/dsar'
import { logAuditEvent } from '@/lib/audit'
import { withServiceRole } from '@/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * GET /api/admin/dsar/export?userId=…&email=… — admin-only Subject Access
 * Request export. Returns the full data bundle as a JSON download. Read-only,
 * but the export itself is audited (a DSAR is a notable, logged action).
 */
export async function GET(req: Request) {
  const session = await authorizeRequest('admin')
  if (session instanceof Response) return session

  try {
    const url = new URL(req.url)
    const userId = url.searchParams.get('userId')
    const email = url.searchParams.get('email')
    if (!userId && !email) {
      return badRequest('Provide userId and/or email')
    }

    const bundle = await exportSubjectData({ userId, email })

    await withServiceRole((tx) =>
      logAuditEvent(tx, {
        category: 'account_status',
        action: 'gdpr.export',
        actorUserId: session.userId,
        targetType: 'data_subject',
        targetId: userId ?? email ?? 'unknown',
        payload: {
          subjectUserId: userId,
          tables: Object.keys(bundle.data),
          storageObjects: bundle.storageObjects.length,
        },
      })
    ).catch(() => {})

    const stamp = bundle.generatedAt.slice(0, 10)
    const name = (userId ?? email ?? 'subject').replace(/[^a-zA-Z0-9._-]/g, '_')
    return new Response(JSON.stringify(bundle, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="dsar-${name}-${stamp}.json"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    console.error('[admin/dsar/export] error:', err)
    return errorResponse(err)
  }
}
