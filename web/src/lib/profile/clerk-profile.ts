import 'server-only'
import { eq } from 'drizzle-orm'
import { db, profiles } from '@/db'

/**
 * Server-only data layer for the clerk profile/settings surface (Lovable
 * port of `ClerkProfile.tsx`). Returns the editable subset of fields plus
 * the read-only stats that drive the performance/quality cards.
 *
 * Verification-affecting fields (DBS / insurance / qualification / gov ID)
 * are intentionally NOT exposed here — those go through the audited
 * onboarding handlers (`/api/onboarding/clerk/{dbs,insurance,identity}`)
 * so any change re-triggers admin verification review.
 */

export type ClerkProfileSettings = {
  // Editable
  fullName: string | null
  phone: string | null
  coverageAreas: string[]
  serviceTypesOffered: string[]
  vehicleDetails: string | null
  languages: string[]
  emergencyContactName: string | null
  emergencyContactPhone: string | null

  // Read-only (display only — drives stats cards)
  email: string | null
  clerkLevel: number | null
  clerkRating: string | null
  clerkJobsCompleted: number | null
  verificationStatus: string | null
}

export async function loadClerkProfileSettings(
  userId: string,
  email: string | null
): Promise<ClerkProfileSettings | null> {
  const [row] = await db
    .select({
      fullName: profiles.fullName,
      phone: profiles.phone,
      coverageAreas: profiles.coverageAreas,
      serviceTypesOffered: profiles.serviceTypesOffered,
      vehicleDetails: profiles.vehicleDetails,
      languages: profiles.languages,
      emergencyContactName: profiles.emergencyContactName,
      emergencyContactPhone: profiles.emergencyContactPhone,
      clerkLevel: profiles.clerkLevel,
      clerkRating: profiles.clerkRating,
      clerkJobsCompleted: profiles.clerkJobsCompleted,
      verificationStatus: profiles.verificationStatus,
    })
    .from(profiles)
    .where(eq(profiles.userId, userId))
    .limit(1)
  if (!row) return null
  return {
    fullName: row.fullName,
    phone: row.phone,
    coverageAreas: (row.coverageAreas ?? []).filter(Boolean),
    serviceTypesOffered: (row.serviceTypesOffered ?? []).filter(Boolean),
    vehicleDetails: row.vehicleDetails,
    languages: (row.languages ?? []).filter(Boolean),
    emergencyContactName: row.emergencyContactName,
    emergencyContactPhone: row.emergencyContactPhone,
    email,
    clerkLevel: row.clerkLevel,
    clerkRating: row.clerkRating,
    clerkJobsCompleted: row.clerkJobsCompleted,
    verificationStatus: row.verificationStatus,
  }
}

export const SERVICE_TYPE_OPTIONS = [
  { value: 'new_inventory', label: 'New Inventory' },
  { value: 'check_in', label: 'Check-In' },
  { value: 'check_out', label: 'Check-Out' },
  { value: 'mid_term', label: 'Mid-Term' },
  { value: 'interim', label: 'Interim' },
] as const

export const LANGUAGE_OPTIONS = [
  'English',
  'Polish',
  'Romanian',
  'Hindi',
  'Urdu',
  'Bengali',
  'Punjabi',
  'Arabic',
  'French',
  'Spanish',
  'Portuguese',
] as const
