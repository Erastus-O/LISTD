import { eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { errorResponse, notFound, ok } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import { reportTemplates, withServiceRole } from '@/db'
import { callerIp, callerUserAgent, logAuditEvent } from '@/lib/audit'
import { bustReportTemplates } from '@/lib/dashboard/admin-report-templates'

export const maxDuration = 10
export const runtime = 'nodejs'

const ItemSchema = z.object({ name: z.string().trim().min(1).max(120) })
const AreaSchema = z.object({
  name: z.string().trim().min(1).max(120),
  items: z.array(ItemSchema).max(120),
})

const RequestSchema = z
  .object({
    /** Present on update; omitted for create. */
    id: z.string().uuid().optional(),
    name: z.string().trim().min(1).max(200),
    structure: z.array(AreaSchema).max(60),
  })
  .strict()

/**
 * POST /api/admin/report-templates — upsert a report template.
 *
 * Lovable used a single upsert handler keyed on the optional `id`; we mirror
 * that shape so the editor modal can post the same payload for create and
 * update without branching the URL.
 *
 * Each mutation writes a `platform_setting/report_template.<action>` audit
 * row inside the same tx — same category as the pricing-table edits in
 * `/api/admin/pricing/route.ts` since both are "admin curates content used
 * across the platform".
 */
export async function POST(req: Request) {
  const session = await authorizeRequest('admin')
  if (session instanceof Response) return session

  try {
    const body = RequestSchema.parse(await req.json())
    const ip = callerIp(req)
    const ua = callerUserAgent(req)

    const cleanedStructure = body.structure
      .map((a) => ({
        name: a.name.trim(),
        items: a.items
          .map((i) => ({ name: i.name.trim() }))
          .filter((i) => i.name.length > 0),
      }))
      .filter((a) => a.name.length > 0)

    const result = await withServiceRole(async (tx) => {
      if (body.id) {
        const [existing] = await tx
          .select({
            id: reportTemplates.id,
            name: reportTemplates.name,
            structure: reportTemplates.structure,
          })
          .from(reportTemplates)
          .where(eq(reportTemplates.id, body.id))
          .limit(1)
        if (!existing) return { status: 'not_found' as const }

        const [updated] = await tx
          .update(reportTemplates)
          .set({
            name: body.name,
            structure: cleanedStructure,
            updatedAt: sql`now()`,
          })
          .where(eq(reportTemplates.id, body.id))
          .returning({ id: reportTemplates.id })

        await logAuditEvent(tx, {
          category: 'platform_setting',
          action: 'report_template.updated',
          actorUserId: session.userId,
          targetType: 'report_template',
          targetId: updated.id,
          payload: {
            previousName: existing.name,
            nextName: body.name,
            areaCount: cleanedStructure.length,
            itemCount: cleanedStructure.reduce(
              (n, a) => n + a.items.length,
              0
            ),
          },
          ipAddress: ip,
          userAgent: ua,
        })
        return { status: 'ok' as const, id: updated.id }
      }

      const [inserted] = await tx
        .insert(reportTemplates)
        .values({
          name: body.name,
          structure: cleanedStructure,
          isActive: true,
          createdBy: session.userId,
        })
        .returning({ id: reportTemplates.id })

      await logAuditEvent(tx, {
        category: 'platform_setting',
        action: 'report_template.created',
        actorUserId: session.userId,
        targetType: 'report_template',
        targetId: inserted.id,
        payload: {
          name: body.name,
          areaCount: cleanedStructure.length,
          itemCount: cleanedStructure.reduce(
            (n, a) => n + a.items.length,
            0
          ),
        },
        ipAddress: ip,
        userAgent: ua,
      })

      return { status: 'ok' as const, id: inserted.id }
    })

    if (result.status === 'not_found') return notFound('Template not found')
    await bustReportTemplates()
    return ok({ success: true, id: result.id })
  } catch (err) {
    console.error('[admin/report-templates] error:', err)
    return errorResponse(err)
  }
}
