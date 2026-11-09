import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { errorResponse, ok } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import {
  loadVacancies,
  saveVacancies,
  vacancySlug,
  type Vacancy,
} from '@/lib/careers'
import { callerIp, callerUserAgent, logAuditEvent } from '@/lib/audit'
import { withServiceRole } from '@/db'

export const runtime = 'nodejs'

const httpsUrl = z
  .string()
  .trim()
  .max(500)
  .refine((v) => !v || /^https:\/\//i.test(v), {
    message: 'Links must start with https://',
  })

const VacancySchema = z.object({
  id: z.string().min(1).max(60),
  slug: z.string().trim().max(80).optional(),
  title: z.string().trim().min(2).max(120),
  location: z.string().trim().max(120),
  employmentType: z.string().trim().min(1).max(60),
  salary: z.string().trim().max(80).optional(),
  description: z.string().trim().max(2000),
  /** Indeed / LinkedIn posting URLs — the Apply buttons deep-link here. */
  indeedUrl: httpsUrl.optional(),
  linkedinUrl: httpsUrl.optional(),
  enabled: z.boolean(),
  createdAt: z.string(),
})

const RequestSchema = z.object({
  vacancies: z.array(VacancySchema).max(50),
})

/** GET /api/admin/careers — full vacancy list for the manager (admin only). */
export async function GET() {
  const session = await authorizeRequest('admin')
  if (session instanceof Response) return session
  try {
    return ok({ vacancies: await loadVacancies() })
  } catch (err) {
    return errorResponse(err)
  }
}

/**
 * POST /api/admin/careers — replace the vacancy list (admin only). The
 * landing page + /careers revalidate immediately, so a newly posted role
 * (or a taken-down one) is live within seconds.
 */
export async function POST(req: Request) {
  const session = await authorizeRequest('admin')
  if (session instanceof Response) return session

  try {
    const { vacancies } = RequestSchema.parse(await req.json())

    const clean: Vacancy[] = vacancies.map((v) => ({
      ...v,
      // Slug is stamped once and stays stable afterwards — it's the public
      // application URL the admin pastes into Indeed/LinkedIn, so a title
      // edit must not break links already out in the wild.
      slug: v.slug || vacancySlug(v),
      salary: v.salary || undefined,
      indeedUrl: v.indeedUrl || undefined,
      linkedinUrl: v.linkedinUrl || undefined,
    }))

    await saveVacancies(clean, session.userId)
    await withServiceRole((tx) =>
      logAuditEvent(tx, {
        category: 'platform_setting',
        action: 'careers.saved',
        actorUserId: session.userId,
        targetType: 'platform_settings',
        targetId: 'careers_vacancies',
        payload: {
          count: clean.length,
          openCount: clean.filter((v) => v.enabled).length,
        },
        ipAddress: callerIp(req),
        userAgent: callerUserAgent(req),
      })
    )

    revalidatePath('/')
    revalidatePath('/careers')

    return ok({ success: true, vacancies: clean })
  } catch (err) {
    return errorResponse(err)
  }
}
