import Link from 'next/link'
import { Calendar, ChevronRight, PoundSterling } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { requireRole } from '@/lib/dal'
import { loadCleanerJobs } from '@/lib/dashboard/cleaner-jobs'
import { StatusPill } from '@/components/listd/job-status'

export const metadata = { title: 'Cleaner · My Jobs' }
export const dynamic = 'force-dynamic'

export default async function CleanerJobsPage() {
  const session = await requireRole('cleaner', 'admin')
  const rows = await loadCleanerJobs(session.userId)

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-6 py-10">
      <div>
        <h1 className="font-display text-3xl text-foreground">My jobs</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {rows.length} {rows.length === 1 ? 'job' : 'jobs'}
        </p>
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center text-sm text-muted-foreground">
            You haven&rsquo;t accepted any cleans yet.{' '}
            <Link href="/cleaner/jobs/available" className="text-primary hover:underline">
              Browse available cleans
            </Link>
            .
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {rows.map((job) => {
            const beds = job.property.bedrooms
            const pay = Number(job.cleanerFinalPayout ?? job.cleanerPayout ?? 0)
            return (
              <Link key={job.id} href={`/cleaner/jobs/${job.id}`}>
                <Card className="transition-colors hover:border-primary/50">
                  <CardContent className="flex items-center justify-between gap-3 p-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs">
                          {job.label}
                        </Badge>
                        <StatusPill status={job.status} />
                      </div>
                      <p className="text-sm font-medium text-foreground">
                        {beds === 0 ? 'Studio' : `${beds} bedroom${beds === 1 ? '' : 's'}`}
                        {job.property.city ? ` · ${job.property.city}` : ''}
                        {job.property.postcode ? ` (${job.property.postcode})` : ''}
                      </p>
                      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Calendar className="h-3 w-3" />
                        {new Date(job.scheduledDate).toLocaleDateString('en-GB', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="flex items-center gap-1 text-base font-bold text-foreground">
                        <PoundSterling className="h-4 w-4" />
                        {pay.toFixed(2)}
                      </span>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </CardContent>
                </Card>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
