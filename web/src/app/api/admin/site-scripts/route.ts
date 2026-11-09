import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { errorResponse, ok } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import { withServiceRole } from '@/db'
import { callerIp, callerUserAgent, logAuditEvent } from '@/lib/audit'
import { MARKETING_META_PATHS } from '@/lib/seo-meta'
import {
  SITE_SCRIPT_MAX,
  loadSiteScripts,
  saveSiteScripts,
} from '@/lib/site-scripts'

export const runtime = 'nodejs'

const RequestSchema = z.object({
  head: z.string().max(SITE_SCRIPT_MAX),
  bodyEnd: z.string().max(SITE_SCRIPT_MAX),
})

/**
 * POST /api/admin/site-scripts — save the site-wide marketing/tracking code
 * for the PUBLIC pages. Admin + the restricted 'marketing' seat (the SEO
 * agency) so they can self-serve without a deploy.
 *
 * This writes code that executes on the public site, so every save is
 * audited with the actor and a size fingerprint. Revalidates the marketing
 * paths so the change is live within seconds.
 */
export async function POST(req: Request) {
  const session = await authorizeRequest('admin', 'marketing')
  if (session instanceof Response) return session

  try {
    const body = RequestSchema.parse(await req.json())
    await saveSiteScripts(body, session.userId)

    await withServiceRole((tx) =>
      logAuditEvent(tx, {
        category: 'platform_setting',
        action: 'site_scripts.saved',
        actorUserId: session.userId,
        targetType: 'platform_settings',
        targetId: 'site_scripts',
        payload: {
          headChars: body.head.trim().length,
          bodyEndChars: body.bodyEnd.trim().length,
        },
        ipAddress: callerIp(req),
        userAgent: callerUserAgent(req),
      })
    )

    for (const path of MARKETING_META_PATHS) revalidatePath(path)
    revalidatePath('/careers')

    return ok({ success: true, scripts: await loadSiteScripts() })
  } catch (err) {
    return errorResponse(err)
  }
}
