import { desc } from 'drizzle-orm'
import { trainings, withServiceRole } from '@/db'
import { requireRole } from '@/lib/dal'
import { TrainingAdmin } from './training-admin'

export const metadata = { title: 'Admin · Training' }
export const dynamic = 'force-dynamic'

export default async function AdminTrainingPage() {
  await requireRole('admin')
  const rows = await withServiceRole((tx) => tx.select().from(trainings).orderBy(desc(trainings.createdAt)))
  return <TrainingAdmin rows={rows} />
}
