import 'server-only'
import { desc, eq } from 'drizzle-orm'
import { properties, withServiceRole } from '@/db'

/**
 * Server-only data fetchers for the `/book` flow (S4b of the Lovable port).
 *
 * The `/book` page server component calls these to seed the client
 * orchestrator's initial state without round-tripping a fetch.
 */

export type BookingProperty = {
  id: string
  addressLine1: string
  addressLine2: string | null
  city: string
  postcode: string
  propertyType: string
  furnishedStatus: string
  bedrooms: number
  bathrooms: number
  // Room counts that drive the client per-feature add-ons.
  kitchens: number
  livingRooms: number
  diningAreas: number
  gardens: number
  communalAreas: number
  hallwaysStairs: number
  utilityRooms: number
  storageRooms: number
  heavilyFurnished: boolean
  areaM2: number | null
  outbuildings: boolean
  outdoor: boolean
}

export async function loadUserProperties(
  userId: string
): Promise<BookingProperty[]> {
  return withServiceRole(async (tx) => {
    const rows = await tx
      .select({
        id: properties.id,
        addressLine1: properties.addressLine1,
        addressLine2: properties.addressLine2,
        city: properties.city,
        postcode: properties.postcode,
        propertyType: properties.propertyType,
        furnishedStatus: properties.furnishedStatus,
        bedrooms: properties.bedrooms,
        bathrooms: properties.bathrooms,
        kitchens: properties.kitchens,
        livingRooms: properties.livingRooms,
        diningAreas: properties.diningAreas,
        gardens: properties.gardens,
        communalAreas: properties.communalAreas,
        hallwaysStairs: properties.hallwaysStairs,
        utilityRooms: properties.utilityRooms,
        storageRooms: properties.storageRooms,
        heavilyFurnished: properties.heavilyFurnished,
        areaM2: properties.areaM2,
        outbuildings: properties.outbuildings,
        outdoor: properties.outdoor,
      })
      .from(properties)
      .where(eq(properties.clientId, userId))
      .orderBy(desc(properties.createdAt))
    return rows
  })
}
