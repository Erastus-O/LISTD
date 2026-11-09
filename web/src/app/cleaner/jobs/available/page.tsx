import { AlertCircle, Calendar, Clock, Home, MapPin, PoundSterling } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { requireRole } from '@/lib/dal'
import { loadCleanerAvailableJobs } from '@/lib/dashboard/cleaner-jobs'
import { AcceptCleanButton } from './accept-clean-button'

export const metadata = { title: 'Cleaner · Available Jobs' }
export const dynamic = 'force-dynamic'

export default async function CleanerAvailableJobsPage() {
  const session = await requireRole('cleaner', 'admin')
  const status = session.profile?.verificationStatus ?? 'unverified'

  if (status !== 'verified' && !session.roles.includes('admin')) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16">
        <Card>
          <CardContent className="space-y-3 p-8 text-center">
            <AlertCircle className="mx-auto h-8 w-8 text-muted-foreground" />
            <h1 className="text-xl font-semibold text-foreground">
              Finish verification to see jobs
            </h1>
            <p className="text-sm text-muted-foreground">
              Once your cleaner verification is approved, cleaning jobs in your
              coverage areas will appear here.
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  const { rows, coverageAreas } = await loadCleanerAvailableJobs(session.userId)

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-10">
      <div>
        <h1 className="font-display text-3xl text-foreground">Available cleans</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Cleaning jobs in your coverage area
          {coverageAreas.length > 0 ? ` (${coverageAreas.join(', ')})` : ''}.
        </p>
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center text-sm text-muted-foreground">
            No available cleans right now.
            {coverageAreas.length === 0
              ? ' Add coverage areas in your settings so jobs can match you.'
              : ' Check back soon.'}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {rows.map((job) => {
            const district = job.property.postcode?.split(' ')[0] ?? '—'
            const beds = job.property.bedrooms
            const pay = Number(job.cleanerPayout ?? 0)
            return (
              <Card key={job.id} className="transition-colors hover:border-primary/50">
                <CardContent className="space-y-3 p-5">
                  <div className="flex items-center justify-between gap-2">
                    <Badge variant="outline" className="text-xs">
                      {job.label}
                    </Badge>
                    <span className="flex items-center gap-1 text-lg font-bold text-foreground">
                      <PoundSterling className="h-4 w-4" />
                      {pay.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                    <MapPin className="h-4 w-4 text-muted-foreground" />
                    {district}, {job.property.city ?? '—'}
                  </div>
                  <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    <Home className="h-3.5 w-3.5" />
                    {beds === 0 ? 'Studio' : `${beds} bedroom${beds === 1 ? '' : 's'}`}
                  </div>
                  <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    <Calendar className="h-3.5 w-3.5" />
                    {formatDate(job.scheduledDate)}
                    {job.preferredTimeSlot ? ` · ${job.preferredTimeSlot}` : ''}
                  </div>
                  {job.specialInstructions && (
                    <p className="rounded-md border border-border bg-muted/30 p-2 text-xs text-muted-foreground">
                      {job.specialInstructions}
                    </p>
                  )}
                  <div className="flex items-center justify-between pt-1">
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      Posted {formatRelative(job.createdAt)} ago
                    </span>
                    <AcceptCleanButton
                      jobId={job.id}
                      timeSlot={job.preferredTimeSlot}
                    />
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}

function formatDate(ymd: string): string {
  return new Date(ymd).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function formatRelative(iso: string): string {
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}
