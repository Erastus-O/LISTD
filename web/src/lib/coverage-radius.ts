import 'server-only'
import { geocodePostcodes, type LatLng } from '@/lib/geocode'
import { postcodeInCoverage } from '@/lib/coverage'

/**
 * Radius-based coverage for the clerk / cleaner job feeds and the
 * new-job notification fan-out.
 *
 * A coverage entry that is a FULL UK postcode (e.g. "BS6 7SA") covers
 * everything within {@link COVERAGE_RADIUS_KM} of that postcode. District
 * entries ("BS6") and area prefixes ("BS") keep their existing exact /
 * prefix semantics via {@link postcodeInCoverage} — so legacy coverage
 * lists keep working unchanged, and radius kicks in as clerks add full
 * postcodes.
 *
 * Geocoding goes through `geocodePostcodes` (postcodes.io bulk, 30-day
 * cache), so callers should gather ALL postcodes involved and build ONE
 * matcher rather than looping per candidate.
 */

export const COVERAGE_RADIUS_KM = 25

/** Full-postcode shape ("BS6 7SA" / "bs67sa"). Distinct from a district. */
const FULL_POSTCODE_RE = /^([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})$/

/** Normalise to "OUTWARD INWARD" or null if not a full postcode. */
export function asFullPostcode(raw: string | null | undefined): string | null {
  if (!raw) return null
  const m = raw.trim().toUpperCase().replace(/\s+/g, ' ').match(FULL_POSTCODE_RE)
  return m ? `${m[1]} ${m[2]}` : null
}

/** Great-circle distance in km (haversine). */
export function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLng = ((b.lng - a.lng) * Math.PI) / 180
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

export type CoverageMatcher = (
  jobPostcode: string | null | undefined,
  coverageAreas: string[]
) => boolean

/**
 * Build a matcher over a known universe of job postcodes and coverage lists.
 * Bulk-geocodes every full postcode involved (job + coverage) in one pass,
 * then returns a SYNC predicate:
 *
 *   matches ⇔ district/prefix match (legacy)  OR
 *             job is within 25 km of any full-postcode coverage entry.
 *
 * Degrades gracefully: if geocoding fails (network, unknown postcode) the
 * radius arm simply can't match and only the district arm applies — a job
 * is never *excluded* by a geocoding hiccup that district rules would allow.
 */
export async function buildCoverageMatcher(
  jobPostcodes: Array<string | null | undefined>,
  coverageLists: string[][]
): Promise<CoverageMatcher> {
  const toGeocode = new Set<string>()
  for (const pc of jobPostcodes) {
    const full = asFullPostcode(pc)
    if (full) toGeocode.add(full)
  }
  for (const list of coverageLists) {
    for (const entry of list) {
      const full = asFullPostcode(entry)
      if (full) toGeocode.add(full)
    }
  }

  let coords = new Map<string, LatLng>()
  if (toGeocode.size > 0) {
    try {
      coords = await geocodePostcodes(Array.from(toGeocode))
    } catch (err) {
      console.warn('[coverage-radius] geocode failed; district-only match:', err)
    }
  }

  return (jobPostcode, coverageAreas) => {
    // Legacy district / area-prefix semantics always apply.
    if (postcodeInCoverage(jobPostcode, coverageAreas)) return true

    const jobFull = asFullPostcode(jobPostcode)
    const jobPoint = jobFull ? coords.get(jobFull) : undefined
    if (!jobPoint) return false

    for (const entry of coverageAreas) {
      const full = asFullPostcode(entry)
      if (!full) continue
      const point = coords.get(full)
      if (point && haversineKm(jobPoint, point) <= COVERAGE_RADIUS_KM) {
        return true
      }
    }
    return false
  }
}
