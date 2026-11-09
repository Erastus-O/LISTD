import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { errorResponse, notFound, ok } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import { jobApplications, withServiceRole } from '@/db'

export const runtime = 'nodejs'

const PatchSchema = z.object({
  status: z.enum(['new', 'reviewed', 'shortlisted', 'rejected']),
})

/** PATCH /api/admin/careers/applications/[id] — update review status. */
export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ applicationId: string }> }
) {
  const session = await authorizeRequest('admin')
  if (session instanceof Response) return session

  try {
    const { applicationId } = await ctx.params
    const { status } = PatchSchema.parse(await req.json())
    const [row] = await withServiceRole((tx) =>
      tx
        .update(jobApplications)
        .set({ status, updatedAt: new Date().toISOString() })
        .where(eq(jobApplications.id, applicationId))
        .returning({ id: jobApplications.id, status: jobApplications.status })
    )
    if (!row) return notFound('Application not found')
    return ok({ application: row })
  } catch (err) {
    return errorResponse(err)
  }
}
