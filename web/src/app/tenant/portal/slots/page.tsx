import { headers } from 'next/headers'
import { eq } from 'drizzle-orm'
import { CalendarClock } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { db, jobs, properties } from '@/db'
import { rateLimit } from '@/lib/rate-limit'
import { resolveTenantToken } from '@/lib/tenant-tokens'
import {
  isTimeframe,
  slotsForTimeframe,
  timeframeLabel,
  timeframeWindow,
} from '@/lib/scheduling/slots'
import { PortalError } from '../_components/portal-error'
import { SlotPicker } from './slot-picker'

export const metadata = { title: 'Tenant Portal · Choose your time' }
export const dynamic = 'force-dynamic'

type Props = { searchParams: Promise<{ token?: string }> }

export default async function TenantSlotsPage({ searchParams }: Props) {
  const sp = await searchParams
  const h = await headers()
  const ip =
    h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? h.get('x-real-ip')

  const limit = await rateLimit({
    scope: 'tenant-portal',
    identifier: ip ?? 'anon',
    limit: 30,
    windowSeconds: 60,
  })
  if (!limit.allowed) return <PortalError reason="rate_limit" />

  const req = new Request('http://internal/tenant/portal/slots', {
    headers: {
      'x-forwarded-for': h.get('x-forwarded-for') ?? '',
      'user-agent': h.get('user-agent') ?? '',
    },
  })
  const verdict = await resolveTenantToken(sp.token ?? null, 'view_report', req, 'view_slots')
  if (!verdict.ok) return <PortalError reason={verdict.reason} />

  const [job] = await db
    .select({
      scheduledDate: jobs.scheduledDate,
      preferredTimeSlot: jobs.preferredTimeSlot,
      tenantSelectedSlots: jobs.tenantSelectedSlots,
      addressLine1: properties.addressLine1,
      city: properties.city,
      postcode: properties.postcode,
    })
    .from(jobs)
    .leftJoin(properties, eq(properties.id, jobs.propertyId))
    .where(eq(jobs.id, verdict.jobId))
    .limit(1)

  const address = [job?.addressLine1, job?.city, job?.postcode]
    .filter(Boolean)
    .join(', ')
  const dateLabel = job?.scheduledDate
    ? new Date(job.scheduledDate).toLocaleDateString('en-GB', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
      })
    : ''
  const allSlots = slotsForTimeframe(job?.preferredTimeSlot)
  const initial = parseSelectedSlots(job?.tenantSelectedSlots)

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-2">
        <CalendarClock className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        <div>
          <h1 className="text-lg font-bold text-foreground">
            Choose your inspection time
          </h1>
          {address && (
            <p className="mt-0.5 text-sm text-muted-foreground">{address}</p>
          )}
        </div>
      </div>

      {!isTimeframe(job?.preferredTimeSlot) || allSlots.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            No specific time window is set for this inspection yet. The clerk
            will contact you to arrange a time.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="space-y-4 p-5">
            <div className="text-sm">
              <p className="text-foreground">
                <span className="font-medium">{dateLabel}</span>
              </p>
              <p className="text-muted-foreground">
                {timeframeLabel(job?.preferredTimeSlot)} ·{' '}
                {timeframeWindow(job?.preferredTimeSlot)}
              </p>
            </div>
            <p className="text-xs text-muted-foreground">
              Tick every 30-minute slot you&rsquo;d be available for: picking a
              few gives the clerk options to confirm a convenient time.
            </p>
            <SlotPicker
              token={sp.token ?? ''}
              slots={allSlots}
              initial={initial}
            />
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function parseSelectedSlots(value: unknown): string[] {
  if (!value || typeof value !== 'object') return []
  const slots = (value as { slots?: unknown }).slots
  if (!Array.isArray(slots)) return []
  return slots.filter((s): s is string => typeof s === 'string')
}
