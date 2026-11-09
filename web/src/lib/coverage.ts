/**
 * UK postcode-district coverage matching for the clerk / cleaner job feeds.
 *
 * A coverage area entry and a property postcode are matched at the *district*
 * boundary, NOT as a raw string prefix. This is the difference that matters:
 *   - "BS1" and "BS14" are DIFFERENT districts. A clerk covering "BS1" must
 *     NOT see "BS14" jobs (the old `district.startsWith("BS1")` returned true
 *     for "BS14" — the bug this replaces).
 *
 * Rules:
 *   - Coverage entry that names a full district (contains a digit, e.g. "BS1",
 *     "BS6", "SW1A") must EQUAL the postcode's outward district. So "BS6"
 *     matches "BS6 7SA" but not "BS60".
 *   - Coverage entry that is an area only (letters, no digit, e.g. "BS")
 *     prefix-matches every district in that area: "BS" → BS1, BS2, BS14, …
 *     This preserves the "broad area" use-case without the cross-district
 *     false positives.
 */

/** Outward district of a postcode — the token before the first space,
 *  upper-cased and space-stripped. "BS6 7SA" → "BS6"; "BS14" → "BS14". */
export function outwardDistrict(
  postcode: string | null | undefined
): string {
  if (!postcode) return ''
  return postcode.trim().toUpperCase().split(/\s+/)[0] ?? ''
}

/** True when `postcode` falls inside any of the clerk/cleaner coverage areas.
 *  An empty `coverageAreas` is treated as "no filter" by callers, so this
 *  returns false here and the caller decides to show everything. */
export function postcodeInCoverage(
  postcode: string | null | undefined,
  coverageAreas: string[]
): boolean {
  const district = outwardDistrict(postcode)
  if (!district) return false
  return coverageAreas.some((raw) => {
    const area = raw.trim().toUpperCase().replace(/\s+/g, '')
    if (!area) return false
    // Area-only entry (no digit) → prefix-match across the whole area.
    if (!/\d/.test(area)) return district.startsWith(area)
    // Full district entry → exact district match.
    return district === area
  })
}
