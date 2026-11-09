import { and, eq, inArray, isNull, notInArray } from 'drizzle-orm'
import { z } from 'zod'
import {
  badRequest,
  errorResponse,
  ok,
  serverError,
} from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import {
  jobs,
  properties,
  withServiceRole,
} from '@/db'
import {
  addressSimilarity,
  extractDate,
  fetchIcalEvents,
  getIcalUrl,
  icalDateToISO,
  type ICalEvent,
} from '@/lib/inventorybase'

export const maxDuration = 30
export const runtime = 'nodejs'

/**
 * POST /api/integrations/inventorybase/sync
 *
 * Replaces supabase/functions/inventorybase-sync/index.ts. Admin-only.
 *
 * Two modes:
 *   - **No body / `action !== "auto-link"`** — fetches the InventoryBase iCal
 *     feed, parses events, matches them to unmatched LISTD jobs by date +
 *     fuzzy-address similarity, and returns the proposed matches (no DB
 *     writes — admin reviews before linking).
 *   - **`action === "auto-link"`** — links a specific iCal event UID to a
 *     LISTD job ID. Single targeted UPDATE.
 *
 * Note: the M-Pre task title called this a "webhook handler". The actual
 * source is admin-triggered (Bearer token), not webhook-style — no HMAC.
 * If InventoryBase ever pushes events to us, switch to `verifyHmacSha256`
 * from `@/lib/webhooks` and remove the admin-auth requirement.
 */

const AutoLinkSchema = z.object({
  action: z.literal('auto-link'),
  job_id: z.string().uuid(),
  inventorybase_uid: z.string().min(1),
})

const SyncSchema = z.object({
  action: z.undefined().optional(),
})

const BodySchema = z.union([AutoLinkSchema, SyncSchema])

export async function POST(req: Request) {
  const session = await authorizeRequest('admin')
  if (session instanceof Response) return session

  try {
    let body: z.infer<typeof BodySchema> = {}
    try {
      body = BodySchema.parse(await req.json())
    } catch {
      // Empty body is allowed (sync mode)
    }

    // ── Auto-link branch ────────────────────────────────────────────
    if ('action' in body && body.action === 'auto-link') {
      // Service-role bypass: admin already verified at handler boundary;
      // RLS on `jobs` would limit visibility per-user.
      await withServiceRole(async (tx) =>
        tx
          .update(jobs)
          .set({ inventorybaseJobId: body.inventorybase_uid })
          .where(eq(jobs.id, body.job_id))
      )
      return ok({
        success: true,
        message: 'Job linked to InventoryBase event',
      })
    }

    // ── Sync branch ─────────────────────────────────────────────────
    const calendarUrl = getIcalUrl()
    if (!calendarUrl) {
      return serverError('INVENTORYBASE_CALENDAR_KEY is not configured')
    }

    let events: ICalEvent[]
    try {
      events = await fetchIcalEvents(calendarUrl)
    } catch (err) {
      console.error('[ib-sync] calendar fetch failed:', err)
      return Response.json(
        { error: err instanceof Error ? err.message : 'Calendar fetch failed' },
        { status: 502 }
      )
    }

    // Fetch unmatched, non-terminal jobs + their properties.
    const unmatched = await withServiceRole(async (tx) => {
      const jobsRows = await tx
        .select({
          id: jobs.id,
          scheduledDate: jobs.scheduledDate,
          status: jobs.status,
          inspectionType: jobs.inspectionType,
          propertyId: jobs.propertyId,
        })
        .from(jobs)
        .where(
          and(
            isNull(jobs.inventorybaseJobId),
            notInArray(jobs.status, ['cancelled', 'paid'])
          )
        )

      const propertyIds = Array.from(
        new Set(jobsRows.map((j) => j.propertyId).filter((p): p is string => Boolean(p)))
      )
      const propsRows =
        propertyIds.length === 0
          ? []
          : await tx
              .select({
                id: properties.id,
                addressLine1: properties.addressLine1,
                addressLine2: properties.addressLine2,
                city: properties.city,
                postcode: properties.postcode,
              })
              .from(properties)
              .where(inArray(properties.id, propertyIds))
      const propsMap = new Map(propsRows.map((p) => [p.id, p]))
      return { jobsRows, propsMap }
    })

    const parsedEvents = events.map((e) => {
      const startISO = icalDateToISO(e.dtstart)
      const eventDate = extractDate(startISO)
      const eventLocation = e.location || e.summary || ''

      let bestMatch: {
        job_id: string
        score: number
        property_address: string
      } | null = null

      for (const job of unmatched.jobsRows) {
        if (!job.propertyId) continue
        const prop = unmatched.propsMap.get(job.propertyId)
        if (!prop) continue
        if (eventDate !== job.scheduledDate) continue

        const fullAddress = [
          prop.addressLine1,
          prop.addressLine2,
          prop.city,
          prop.postcode,
        ]
          .filter(Boolean)
          .join(' ')
        const score = addressSimilarity(eventLocation, fullAddress)

        if (score > 0.3 && (!bestMatch || score > bestMatch.score)) {
          bestMatch = {
            job_id: job.id,
            score: Math.round(score * 100),
            property_address: fullAddress,
          }
        }
      }

      return {
        uid: e.uid,
        summary: e.summary,
        description: e.description,
        start_date: startISO,
        end_date: icalDateToISO(e.dtend),
        location: e.location,
        match: bestMatch,
      }
    })

    return ok({
      success: true,
      total_events: parsedEvents.length,
      matched_count: parsedEvents.filter((e) => e.match).length,
      events: parsedEvents,
    })
  } catch (err) {
    if (err instanceof z.ZodError) return badRequest('Invalid request', err.flatten())
    return errorResponse(err)
  }
}
