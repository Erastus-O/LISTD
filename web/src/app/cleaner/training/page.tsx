import { and, eq, inArray, or, isNull } from 'drizzle-orm'
import { trainingCompletions, trainings, withServiceRole } from '@/db'
import { ProLevelsCard, TrainingList } from '@/components/listd/pro-levels-panels'
import { requireRole } from '@/lib/dal'
import { ROLE_LABEL, proRoleSummaries } from '@/lib/listd/pro-levels'
import type { ProRole } from '@/lib/listd/pricing'

export const metadata = { title: 'Training and level' }
export const dynamic = 'force-dynamic'

export default async function TrainingPage() {
  const session = await requireRole('cleaner', 'admin')
  const { roles, items } = await withServiceRole(async (tx) => {
    const summaries = await proRoleSummaries(tx, session.userId)
    const roleKeys = summaries.map((r) => r.role as string)
    const rows = await tx
      .select()
      .from(trainings)
      .where(and(eq(trainings.status, 'PUBLISHED'), or(isNull(trainings.role), roleKeys.length ? inArray(trainings.role, roleKeys) : undefined)))
    const done = await tx
      .select({ id: trainingCompletions.trainingId })
      .from(trainingCompletions)
      .where(eq(trainingCompletions.userId, session.userId))
    const doneIds = new Set(done.map((d) => d.id))
    return {
      roles: summaries,
      items: rows.map((t) => ({
        id: t.id,
        title: t.title,
        description: t.description,
        kind: t.kind,
        url: t.url,
        roleLabel: t.role ? ROLE_LABEL[t.role as ProRole] : null,
        level: t.level,
        minutes: t.minutes,
        done: doneIds.has(t.id),
      })),
    }
  })
  return (
    <div className="w-full px-4 py-8 sm:px-6 sm:py-10">
      <div className="a-page">
        <div className="a-head">
          <div>
            <h1>Training and level</h1>
            <p>Three levels in every role, unlocked by completed jobs and ratings. LISTD sets the hourly rate for each.</p>
          </div>
        </div>
        <section className="a-sec">
          <h2>Your roles</h2>
          <ProLevelsCard roles={roles} />
        </section>
        <section className="a-sec">
          <h2>Training</h2>
          <TrainingList items={items} />
        </section>
      </div>
    </div>
  )
}
