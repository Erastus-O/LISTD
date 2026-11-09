import { and, eq } from 'drizzle-orm'
import { errorResponse, notFound, ok } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import { trainingCompletions, trainings, withServiceRole } from '@/db'

export const runtime = 'nodejs'

type Params = Promise<{ id: string }>

/** POST /api/pro/trainings/[id]/complete: the Pro confirms they finished it. */
export async function POST(_req: Request, { params }: { params: Params }) {
  const session = await authorizeRequest('clerk', 'trades', 'cleaner')
  if (session instanceof Response) return session
  try {
    const { id } = await params
    const done = await withServiceRole(async (tx) => {
      const [t] = await tx.select({ id: trainings.id }).from(trainings).where(and(eq(trainings.id, id), eq(trainings.status, 'PUBLISHED'))).limit(1)
      if (!t) return false
      await tx.insert(trainingCompletions).values({ trainingId: id, userId: session.userId }).onConflictDoNothing()
      return true
    })
    if (!done) return notFound('Training not found')
    return ok({ success: true })
  } catch (err) {
    console.error('[pro/trainings/complete] error:', err)
    return errorResponse(err)
  }
}
