/**
 * Dwelling type — what KIND of building the property is.
 *
 * Not to be confused with `properties.property_type`, which despite the
 * name only ever held the bed count (`studio`, `2_bed`, …) and drives
 * pricing. Job screens that printed `property_type` read back
 * "2_bed · 2 bed · unfurnished"; a Pro deciding whether to accept wants to
 * know it's a first-floor flat, not a house with a garden and three
 * staircases.
 *
 * Stored as plain `text` (0039), so an admin-defined kind never needs a
 * migration. Anything not in this list still renders — `dwellingLabel`
 * falls back to a title-cased version of whatever is on the row.
 */

export const DWELLING_TYPES = [
  'flat',
  'apartment',
  'house',
  'maisonette',
  'bungalow',
  'studio',
  'hmo_room',
  'student_hall',
  'commercial',
] as const

export type DwellingType = (typeof DWELLING_TYPES)[number]

export const DWELLING_TYPE_LABELS: Record<string, string> = {
  flat: 'Flat',
  apartment: 'Apartment',
  house: 'House',
  maisonette: 'Maisonette',
  bungalow: 'Bungalow',
  studio: 'Studio',
  hmo_room: 'HMO room',
  student_hall: 'Student hall',
  commercial: 'Commercial',
}

/** Display label for a stored dwelling type. Unknown values are
 *  title-cased rather than dropped, so an admin-added kind still reads
 *  sensibly wherever it appears. */
export function dwellingLabel(value: string | null | undefined): string | null {
  const key = (value ?? '').trim()
  if (!key) return null
  return (
    DWELLING_TYPE_LABELS[key] ??
    key
      .replace(/[_-]+/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase())
  )
}

/**
 * The one-line property summary used on job cards and detail screens:
 * "Flat · 2 bed · Unfurnished".
 *
 * Skips the size token when the dwelling type already says it (a studio
 * has no bedrooms, so "Studio · 0 bed" is noise), and drops any part that
 * isn't recorded rather than printing a placeholder.
 */
export function propertySummary(p: {
  dwellingType?: string | null
  bedrooms?: number | null
  furnishedStatus?: string | null
}): string {
  const dwelling = dwellingLabel(p.dwellingType)
  const isStudio = (p.dwellingType ?? '').trim() === 'studio'
  const beds =
    !isStudio && typeof p.bedrooms === 'number' && p.bedrooms > 0
      ? `${p.bedrooms} bed`
      : null
  const furnished = p.furnishedStatus
    ? p.furnishedStatus.replace(/[_-]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
    : null
  const parts = [dwelling, beds, furnished].filter(Boolean)
  return parts.length > 0 ? parts.join(' · ') : '—'
}
