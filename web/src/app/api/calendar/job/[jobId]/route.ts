import { and, eq, or } from 'drizzle-orm'
import { errorResponse, forbidden, notFound, unauthorized } from '@/lib/api'
import { getSession } from '@/lib/dal'
import {
  jobs,
  organisationMembers,
  properties,
  withServiceRole,
} from '@/db'
import {
  buildIcsContent,
  resolveJobSchedule,
  type CalendarEvent,
} from '@/lib/calendar'
import { formatJobReference } from '@/lib/jobs/reference'
import { serviceLabel } from '@/lib/pricing-matrix'

export const maxDuration = 10
export const runtime = 'nodejs'

type Params = Promise<{ jobId: string }>

/**
 * GET /api/calendar/job/[jobId] — return an .ics file for a single job.
 *
 * Auth: any signed-in user, but only returns the file if they actually
 * have a stake in the job (client, clerk, org owner, or admin). The
 * authorization check mirrors the read paths used by the role-specific
 * job detail loaders — keep them in lockstep if either changes.
 *
 * The response is served with `Content-Disposition: attachment` so the
 * user's OS opens it in their default calendar app instead of
 * rendering it as text. The filename includes the inspection type +
 * short job ref so multiple downloads stay distinguishable.
 */
export async function GET(_req: Request, { params }: { params: Params }) {
  try {
    const session = await getSession()
    if (!session) return unauthorized()
    const { jobId } = await params

    const result = await withServiceRole(async (tx) => {
      const [job] = await tx
        .select({
          id: jobs.id,
          clientId: jobs.clientId,
          clerkId: jobs.clerkId,
          organisationId: jobs.organisationId,
          propertyId: jobs.propertyId,
          inspectionType: jobs.inspectionType,
          scheduledAt: jobs.scheduledAt,
          scheduledDate: jobs.scheduledDate,
          preferredTimeSlot: jobs.preferredTimeSlot,
          accessMethod: jobs.accessMethod,
          accessCollection: jobs.accessCollection,
          accessParkingNotes: jobs.accessParkingNotes,
          specialInstructions: jobs.specialInstructions,
        })
        .from(jobs)
        .where(eq(jobs.id, jobId))
        .limit(1)
      if (!job) return null

      const isAdmin = session.roles.includes('admin')
      const isClient = job.clientId === session.userId
      const isClerk = job.clerkId === session.userId
      let isOrgOwner = false
      if (!isAdmin && !isClient && !isClerk && job.organisationId) {
        const [member] = await tx
          .select({ orgRole: organisationMembers.orgRole })
          .from(organisationMembers)
          .where(
            and(
              eq(organisationMembers.organisationId, job.organisationId),
              eq(organisationMembers.userId, session.userId),
              eq(organisationMembers.status, 'active'),
              or(
                eq(organisationMembers.orgRole, 'owner'),
                eq(organisationMembers.orgRole, 'admin')
              )
            )
          )
          .limit(1)
        isOrgOwner = !!member
      }

      if (!isAdmin && !isClient && !isClerk && !isOrgOwner) {
        return { forbidden: true as const }
      }

      // Resolve property + assemble the event.
      const [prop] = job.propertyId
        ? await tx
            .select({
              addressLine1: properties.addressLine1,
              city: properties.city,
              postcode: properties.postcode,
            })
            .from(properties)
            .where(eq(properties.id, job.propertyId))
            .limit(1)
        : [null]

      return { job, property: prop ?? null }
    })

    if (!result) return notFound('Job not found')
    if ('forbidden' in result) return forbidden('Not your job')

    const { job, property } = result
    const schedule = resolveJobSchedule({
      scheduledAt: job.scheduledAt,
      scheduledDate: job.scheduledDate,
    })
    if (!schedule) return notFound('Job has no schedule')

    const address = property
      ? [property.addressLine1, property.city, property.postcode]
          .filter(Boolean)
          .join(', ')
      : 'TBC'
    const label = serviceLabel(job.inspectionType)
    const reference = formatJobReference({
      jobId: job.id,
      addressLine1: property?.addressLine1,
      postcode: property?.postcode,
    })
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://listd.co.uk'
    const jobUrl = `${siteUrl}/${
      job.clerkId === session.userId ? 'clerk' : 'client'
    }/jobs/${job.id}`

    const accessLine = [
      job.accessMethod,
      job.accessCollection,
      job.accessParkingNotes,
    ]
      .filter(Boolean)
      .join(' · ')
    const descriptionLines = [
      `Inspection: ${label}`,
      `Reference: ${reference}`,
    ]
    if (!schedule.isExactTime) {
      descriptionLines.push(
        '(Time is a placeholder : please confirm the exact slot.)'
      )
      if (job.preferredTimeSlot) {
        descriptionLines.push(`Preferred time: ${job.preferredTimeSlot}`)
      }
    }
    if (accessLine) descriptionLines.push(`Access: ${accessLine}`)
    if (job.specialInstructions) {
      descriptionLines.push(`Notes: ${job.specialInstructions}`)
    }
    descriptionLines.push('', `Manage on LISTD: ${jobUrl}`)

    const event: CalendarEvent = {
      // Same UID across re-downloads → re-importing updates rather than
      // duplicates in the user's calendar.
      uid: `job-${job.id}`,
      title: `LISTD Inspection: ${label} at ${property?.addressLine1 ?? 'your property'}`,
      description: descriptionLines.join('\n'),
      location: address,
      startsAt: schedule.startsAt,
      endsAt: schedule.endsAt,
      url: jobUrl,
    }

    const ics = buildIcsContent(event)
    return new Response(ics, {
      status: 200,
      headers: {
        'content-type': 'text/calendar; charset=utf-8',
        'content-disposition': `attachment; filename="listd-${label.toLowerCase().replace(/\s+/g, '-')}-${reference}.ics"`,
        'cache-control': 'private, max-age=0, must-revalidate',
      },
    })
  } catch (err) {
    console.error('[calendar/job] error:', err)
    return errorResponse(err)
  }
}
