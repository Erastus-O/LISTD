/**
 * Address disclosure rules.
 *
 * A published job is visible to every Pro whose coverage matches, none of
 * whom have been vetted *for that job* yet. Handing out the exact door
 * before anyone commits leaks a tenant's address to a crowd; the outward
 * code is enough to judge the trip and the payout.
 *
 * So: **town + outward district pre-accept, full address after.** The
 * desktop feed already withheld `address_line_1`; these helpers make the
 * rule explicit, apply it to the postcode too, and let the mobile app
 * share the same behaviour.
 */

/** "BS6 7SA" → "BS6". Returns null when there's nothing usable. */
export function outwardCode(postcode: string | null | undefined): string | null {
  const raw = (postcode ?? '').trim().toUpperCase()
  if (!raw) return null
  // Space-separated is the common case. Fall back to the UK format's
  // "everything bar the final three characters" for unspaced input.
  const spaced = raw.split(/\s+/)[0]
  if (spaced && spaced !== raw) return spaced
  if (raw.length > 3) return raw.slice(0, raw.length - 3)
  return raw
}

/**
 * What a Pro sees BEFORE accepting: "Bristol · BS6". Falls back to
 * whichever half exists, and to a neutral label when neither does — never
 * to the full address.
 */
export function maskedLocation(p: {
  city?: string | null
  postcode?: string | null
} | null): string {
  if (!p) return 'Location on accept'
  const district = outwardCode(p.postcode)
  const parts = [p.city?.trim() || null, district].filter(Boolean)
  return parts.length > 0 ? parts.join(' · ') : 'Location on accept'
}

/** What the assigned Pro sees AFTER accepting: the full address. */
export function fullAddress(p: {
  addressLine1?: string | null
  addressLine2?: string | null
  city?: string | null
  postcode?: string | null
} | null): string {
  if (!p) return '—'
  const parts = [p.addressLine1, p.addressLine2, p.city, p.postcode]
    .map((s) => s?.trim() || null)
    .filter(Boolean)
  return parts.length > 0 ? parts.join(', ') : '—'
}

/**
 * Single entry point for anything that renders an address next to a job:
 * pass whether this viewer has the job, get the right disclosure level.
 */
export function jobAddress(
  p: {
    addressLine1?: string | null
    addressLine2?: string | null
    city?: string | null
    postcode?: string | null
  } | null,
  opts: { accepted: boolean }
): string {
  return opts.accepted ? fullAddress(p) : maskedLocation(p)
}
