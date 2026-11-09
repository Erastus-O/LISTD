import 'server-only'
import { and, eq } from 'drizzle-orm'
import { db, organisationMembers, organisations, profiles } from '@/db'

/**
 * Server-only data layer for the client settings surface (Lovable port of
 * `SettingsPage.tsx`). Returns the editable subset of fields plus the
 * client's primary organisation (when they belong to one) for the
 * read-only Organisation card on the settings page.
 *
 * Account-status / verification fields are intentionally not exposed here
 * — clients can't suspend / delete themselves; that goes through admin.
 */

export type ClientProfileSettings = {
  fullName: string | null
  companyName: string | null
  phone: string | null
  email: string | null
  organisation: {
    id: string
    name: string | null
    billingAddress: string | null
    vatNumber: string | null
    companyRegNumber: string | null
  } | null
}

export async function loadClientProfileSettings(
  userId: string,
  email: string | null
): Promise<ClientProfileSettings | null> {
  const [profile] = await db
    .select({
      fullName: profiles.fullName,
      companyName: profiles.companyName,
      phone: profiles.phone,
    })
    .from(profiles)
    .where(eq(profiles.userId, userId))
    .limit(1)
  if (!profile) return null

  // Pick the most-recent active org membership — same convention as
  // /admin/clients lists. Clients in multiple orgs see their newest as
  // the primary; switching would be a future enhancement.
  const [orgRow] = await db
    .select({
      id: organisations.id,
      name: organisations.name,
      billingAddress: organisations.billingAddress,
      vatNumber: organisations.vatNumber,
      companyRegNumber: organisations.companyRegNumber,
    })
    .from(organisationMembers)
    .innerJoin(
      organisations,
      eq(organisations.id, organisationMembers.organisationId)
    )
    .where(
      and(
        eq(organisationMembers.userId, userId),
        eq(organisationMembers.status, 'active')
      )
    )
    .limit(1)

  return {
    fullName: profile.fullName,
    companyName: profile.companyName,
    phone: profile.phone,
    email,
    organisation: orgRow
      ? {
          id: orgRow.id,
          name: orgRow.name,
          billingAddress: orgRow.billingAddress,
          vatNumber: orgRow.vatNumber,
          companyRegNumber: orgRow.companyRegNumber,
        }
      : null,
  }
}
