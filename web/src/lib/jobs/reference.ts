/**
 * Human-readable job reference. The underlying primary key (`jobs.id`) stays
 * a UUID — too many places (URLs, foreign keys, audit rows) depend on it —
 * but UIs, PDFs and `.ics` filenames render this slug instead, so a person
 * looking at a list of jobs can identify which property each one belongs
 * to without clicking through.
 *
 * Shape: `<address-words>-<postcode-district>-<id-suffix>`
 *
 *   • "123 High Street", "SW1A 1AA"  →  `123-HIGH-SW1A-70254FD9`
 *   • "Suite 41, 14-15 Triangle South", "BS8 4PQ"  →  `SUITE-41-BS8-70254FD9`
 *
 * Computed on the fly from the property + the UUID, so it stays in sync
 * with the property record without needing a stored column. Pure function,
 * trivially testable.
 */
export function formatJobReference(input: {
  jobId: string
  /** Property address line 1. May be empty / unknown. */
  addressLine1?: string | null
  /** Property postcode. May be empty / unknown. */
  postcode?: string | null
}): string {
  const addrSlug = slugifyAddress(input.addressLine1 ?? '', 20)
  const district = postcodeDistrict(input.postcode ?? '')
  const idSlug = shortId(input.jobId)
  return [addrSlug, district, idSlug].filter(Boolean).join('-')
}

/**
 * The 8-char UUID suffix on its own. Useful for the rare places that still
 * want a compact identifier (logs, very narrow columns) but want it
 * uppercase and dash-free for consistency with `formatJobReference`.
 */
export function shortJobId(jobId: string): string {
  return shortId(jobId)
}

// ── helpers ─────────────────────────────────────────────────────────

function slugifyAddress(addr: string, maxChars: number): string {
  const tokens = addr
    .split(/[\s,]+/)
    .map((t) => t.replace(/[^A-Za-z0-9]/g, ''))
    .filter(Boolean)
    .slice(0, 2)
  if (tokens.length === 0) return ''
  const joined = tokens.join('-').toUpperCase()
  return joined.length > maxChars ? joined.slice(0, maxChars) : joined
}

function postcodeDistrict(postcode: string): string {
  const first = postcode.trim().split(/\s+/)[0] ?? ''
  return first.replace(/[^A-Za-z0-9]/g, '').toUpperCase()
}

function shortId(jobId: string): string {
  return jobId.replace(/-/g, '').slice(0, 8).toUpperCase()
}
