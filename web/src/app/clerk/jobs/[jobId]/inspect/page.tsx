import Link from 'next/link'
import { redirect } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { ArrowLeft, Camera, RotateCcw } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { db, jobs, profiles, properties } from '@/db'
import { requireRole } from '@/lib/dal'
import { deriveRooms } from '@/lib/inspection/build-rooms'
import {
  loadPriorReturnedSubmission,
  priorRoomsAsDerived,
} from '@/lib/inspect/prior-submission'
import { loadMobileCaptures } from '@/lib/inspect/mobile-captures'
import { loadBaselineForJob } from '@/lib/inspect/baseline'
import { InspectionForm } from './_components/inspection-form'

export const metadata = { title: 'Inspect Property' }
export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ jobId: string }> }

/**
 * Clerk inspection wizard. Replaces the simple PDF-upload flow at
 * `/submit-report` — this page asks the clerk to record condition
 * + cleanliness per inventory item, attach photos browser-direct,
 * and sign off with a typed name. The server renders the PDF.
 *
 * Hard-gated: only the assigned clerk on a job in `in_progress`
 * status gets through. Anything else bounces back to the job detail.
 */
export default async function ClerkInspectPage({ params }: Props) {
  const session = await requireRole('clerk', 'trades', 'admin')
  const { jobId } = await params

  const [row] = await db
    .select({
      jobId: jobs.id,
      clerkId: jobs.clerkId,
      status: jobs.status,
      addressLine1: properties.addressLine1,
      city: properties.city,
      postcode: properties.postcode,
      bedrooms: properties.bedrooms,
      bathrooms: properties.bathrooms,
      kitchens: properties.kitchens,
      livingRooms: properties.livingRooms,
      diningAreas: properties.diningAreas,
      hallwaysStairs: properties.hallwaysStairs,
      utilityRooms: properties.utilityRooms,
      storageRooms: properties.storageRooms,
      gardens: properties.gardens,
    })
    .from(jobs)
    .leftJoin(properties, eq(properties.id, jobs.propertyId))
    .where(eq(jobs.id, jobId))
    .limit(1)

  if (
    !row ||
    (row.clerkId !== session.userId && !session.roles.includes('admin')) ||
    row.status !== 'in_progress'
  ) {
    redirect(`/clerk/jobs/${jobId}`)
  }

  const [clerkProfile] = await db
    .select({ fullName: profiles.fullName })
    .from(profiles)
    .where(eq(profiles.userId, session.userId))
    .limit(1)

  // Seed precedence:
  //   1. Returned-for-amends — admin sent the report back; hydrate the
  //      clerk's full previous write-up so they edit in place.
  //   2. Mobile captures — clerk took photos on-site with the PWA;
  //      pre-load those thumbnails under their rooms + item titles so the
  //      clerk only has to add descriptions + conditions on the desktop.
  //   3. Property-derived blank rooms (first-time, desktop-only path).
  const priorSubmission = await loadPriorReturnedSubmission(jobId)
  const mobileCaptures = priorSubmission
    ? null
    : await loadMobileCaptures(jobId)
  const seed = priorSubmission ?? mobileCaptures
  // Before/after: the property's most recent prior inspection supplies the
  // "before" photos, matched to each room+item below.
  const baseline = await loadBaselineForJob(jobId)
  const initialRooms = seed
    ? priorRoomsAsDerived(seed)
    : deriveRooms({
        hallwaysStairs: row.hallwaysStairs ?? 0,
        livingRooms: row.livingRooms ?? 0,
        diningAreas: row.diningAreas ?? 0,
        kitchens: row.kitchens ?? 0,
        bedrooms: row.bedrooms ?? 0,
        bathrooms: row.bathrooms ?? 0,
        utilityRooms: row.utilityRooms ?? 0,
        storageRooms: row.storageRooms ?? 0,
        gardens: row.gardens ?? 0,
      })

  const addressLine = row.addressLine1
    ? `${row.addressLine1}${row.city ? ', ' + row.city : ''}${
        row.postcode ? ' ' + row.postcode : ''
      }`
    : 'this property'

  return (
    <div className="w-full space-y-6 px-6 py-10">
      <Link
        href={`/clerk/jobs/${jobId}`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to job
      </Link>

      <div>
        <h1 className="font-display text-3xl text-foreground">
          Inspect property
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Job {jobId.slice(0, 8)} · {addressLine}
        </p>
      </div>

      {priorSubmission ? (
        <Card className="border-amber-500/40 bg-amber-50/50">
          <CardContent className="flex items-start gap-3 p-4 text-sm text-amber-900">
            <RotateCcw className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-medium">
                This report was returned by QA for amendments.
              </p>
              <p className="mt-1 text-xs">
                Your previous answers are pre-filled below: review the
                rooms, items, photos, and meter readings, make the
                changes the reviewer asked for, and submit again.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : mobileCaptures ? (
        <Card className="border-sky-500/40 bg-sky-50/50">
          <CardContent className="flex items-start gap-3 p-4 text-sm text-sky-900">
            <Camera className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-medium">
                Photos from your on-site capture are pre-loaded.
              </p>
              <p className="mt-1 text-xs">
                The images you took with the mobile app appear under their
                rooms and item titles below. Add a description + condition
                for each, then sign off to generate the report.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-4 text-xs text-muted-foreground">
            Walk through each room, record a description + condition for
            every item, and attach photos. The PDF report is generated
            automatically when you sign off.
          </CardContent>
        </Card>
      )}

      <InspectionForm
        jobId={jobId}
        initialRooms={initialRooms}
        defaultClerkName={clerkProfile?.fullName}
        priorSubmission={priorSubmission}
        mobileCaptures={mobileCaptures}
        baseline={baseline}
      />
    </div>
  )
}
