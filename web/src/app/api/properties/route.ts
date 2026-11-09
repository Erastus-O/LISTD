import { z } from 'zod'
import { errorResponse, ok, created } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import { properties, withServiceRole } from '@/db'
import { loadUserProperties } from '@/lib/booking-data'
import { parseSupabaseStorageUrl } from '@/lib/storage/download'
import {
  FURNISHED_STATUSES,
  PROPERTY_SIZES,
} from '@/lib/pricing-matrix'

export const maxDuration = 15
export const runtime = 'nodejs'

/**
 * GET /api/properties — list the caller's properties.
 *
 * Used by the `/book` flow's "Add new" path so a fresh property created
 * mid-flow can refresh the list without a full page reload.
 */
export async function GET() {
  const session = await authorizeRequest()
  if (session instanceof Response) return session
  try {
    const props = await loadUserProperties(session.userId)
    return ok({ properties: props })
  } catch (err) {
    return errorResponse(err)
  }
}

const CreateSchema = z.object({
  addressLine1: z.string().trim().min(1).max(200),
  addressLine2: z.string().trim().max(200).optional(),
  city: z.string().trim().min(1).max(100),
  postcode: z.string().trim().min(1).max(20),
  propertyType: z.enum(PROPERTY_SIZES),
  furnishedStatus: z.enum(FURNISHED_STATUSES),
  bedrooms: z.number().int().min(0).max(20),
  bathrooms: z.number().int().min(0).max(20),
  kitchens: z.number().int().min(0).max(20).optional(),
  livingRooms: z.number().int().min(0).max(20).optional(),
  diningAreas: z.number().int().min(0).max(20).optional(),
  utilityRooms: z.number().int().min(0).max(20).optional(),
  storageRooms: z.number().int().min(0).max(20).optional(),
  hallwaysStairs: z.number().int().min(0).max(20).optional(),
  gardens: z.number().int().min(0).max(20).optional(),
  communalAreas: z.number().int().min(0).max(20).optional(),
  heavilyFurnished: z.boolean().optional(),
  notes: z.string().trim().max(2000).optional(),
  /** 0039 — flat / house / …. Free text so an admin-defined kind works
   *  without a schema change; unknown values render title-cased. */
  dwellingType: z.string().trim().max(40).nullable().optional(),
  /** 0039 — property photo already uploaded browser-direct to the
   *  `property-photos` bucket. Validated below to be OUR bucket, so a
   *  client can't point the job-card thumbnail at an arbitrary host. */
  imageUrl: z.string().url().max(2000).nullable().optional(),
  /** ADMIN ONLY: create the property for this client (on-behalf booking). */
  forClientId: z.string().uuid().optional(),
})

/**
 * The thumbnail renders inside both apps' job feeds, so the URL has to be
 * ours: an arbitrary `https://…` would let a client beacon every Pro who
 * so much as scrolls past the posting, and would survive the DSAR sweep
 * that only knows about our buckets.
 */
function isPropertyPhotoUrl(url: string): boolean {
  const parsed = parseSupabaseStorageUrl(url)
  return parsed?.bucket === 'property-photos'
}

/**
 * POST /api/properties — create a property owned by the caller.
 *
 * Service-role write: caller is authenticated and we constrain `clientId`
 * to `session.userId`. RLS would also permit via the "Clients can insert
 * their own properties" policy, but service-role keeps the handler shape
 * symmetrical with /api/onboarding/client/organisation.
 */
export async function POST(req: Request) {
  const session = await authorizeRequest()
  if (session instanceof Response) return session

  try {
    const body = CreateSchema.parse(await req.json())

    // Admin on-behalf: the property belongs to the target client.
    if (body.forClientId && !session.roles.includes('admin')) {
      return Response.json(
        { error: 'Only admins can create properties for a client.' },
        { status: 403 }
      )
    }
    const ownerId = body.forClientId ?? session.userId

    if (body.imageUrl && !isPropertyPhotoUrl(body.imageUrl)) {
      return Response.json(
        { error: 'Property photo must be uploaded to LISTD storage.' },
        { status: 400 }
      )
    }

    const inserted = await withServiceRole(async (tx) => {
      const [row] = await tx
        .insert(properties)
        .values({
          clientId: ownerId,
          addressLine1: body.addressLine1,
          addressLine2: body.addressLine2 || null,
          city: body.city,
          postcode: body.postcode.toUpperCase(),
          propertyType: body.propertyType,
          furnishedStatus: body.furnishedStatus,
          bedrooms: body.bedrooms,
          bathrooms: body.bathrooms,
          kitchens: body.kitchens ?? 1,
          livingRooms: body.livingRooms ?? 1,
          diningAreas: body.diningAreas ?? 0,
          utilityRooms: body.utilityRooms ?? 0,
          storageRooms: body.storageRooms ?? 0,
          hallwaysStairs: body.hallwaysStairs ?? 0,
          gardens: body.gardens ?? 0,
          communalAreas: body.communalAreas ?? 0,
          heavilyFurnished: body.heavilyFurnished ?? false,
          dwellingType: body.dwellingType || null,
          imageUrl: body.imageUrl || null,
          notes: body.notes || null,
        })
        .returning()
      return row
    })

    return created({ property: inserted })
  } catch (err) {
    return errorResponse(err)
  }
}
