import 'server-only'
import { bust, cacheKey, getRaw, setRaw } from './cache'

/**
 * Server-side UK postcode geocoder. Uses the free postcodes.io bulk
 * endpoint — no API key, no rate-limit headers, funded by the Ministry
 * of Housing & ONS. Per-postcode results cache in Upstash for 30 days
 * because postcodes don't move (and the API is fair-use, not a metered
 * service we want to lean on).
 *
 * Returns a Map keyed by uppercase, single-space-normalised postcode so
 * callers can iterate their jobs and look up coords without re-querying.
 * Unknown postcodes are silently absent from the result Map — the map
 * UI skips them rather than 500ing the whole page.
 */

export type LatLng = { lat: number; lng: number }

const CACHE_TTL_SECONDS = 60 * 60 * 24 * 30 // 30 days
const BULK_ENDPOINT = 'https://api.postcodes.io/postcodes'
const BULK_CHUNK = 100 // postcodes.io caps bulk requests at 100

/**
 * Look up coordinates for many postcodes at once. Two-pass:
 *
 *   1. Read every postcode from Upstash in parallel; hits land in `out`.
 *   2. Anything missing goes to postcodes.io in 100-at-a-time batches,
 *      then each result is written to cache for 30 days.
 *
 * The end result is one `Map<normalisedPostcode, {lat,lng}>`. Postcodes
 * that postcodes.io doesn't recognise are silently absent.
 */
export async function geocodePostcodes(
  postcodes: string[]
): Promise<Map<string, LatLng>> {
  const normalised = Array.from(
    new Set(postcodes.map(normalisePostcode).filter(Boolean))
  ) as string[]
  const out = new Map<string, LatLng>()
  if (normalised.length === 0) return out

  // Pass 1: read cache for every postcode in parallel.
  const cacheReads = await Promise.all(
    normalised.map(async (pc) => {
      const hit = await getRaw<LatLng>(cacheKey('geocode:postcode', pc))
      return [pc, hit] as const
    })
  )
  const misses: string[] = []
  for (const [pc, hit] of cacheReads) {
    if (hit) out.set(pc, hit)
    else misses.push(pc)
  }
  if (misses.length === 0) return out

  // Pass 2: batch-fetch the misses, write each result back to cache.
  for (let i = 0; i < misses.length; i += BULK_CHUNK) {
    const chunk = misses.slice(i, i + BULK_CHUNK)
    const coords = await bulkLookup(chunk)
    // Write hits back; fire-and-forget on each to avoid sequential
    // round-trips. Unrecognised postcodes are simply not written —
    // we'll retry them next time, but they're rare enough to ignore.
    await Promise.all(
      Array.from(coords.entries()).map(([pc, latlng]) => {
        out.set(pc, latlng)
        return setRaw(cacheKey('geocode:postcode', pc), latlng, CACHE_TTL_SECONDS)
      })
    )
  }

  return out
}

/** Invalidate a single postcode's cached coords. Rarely needed —
 *  exposed for tests / admin tooling that wants to force a re-lookup. */
export async function bustGeocode(postcode: string): Promise<void> {
  const pc = normalisePostcode(postcode)
  if (pc) await bust(cacheKey('geocode:postcode', pc))
}

// ── helpers ─────────────────────────────────────────────────────────

/**
 * Normalise to postcodes.io's canonical shape: uppercase, single space
 * between the outward and inward codes. Returns null if the input
 * doesn't look like a UK postcode shape.
 */
function normalisePostcode(raw: string): string | null {
  const cleaned = raw.replace(/\s+/g, '').toUpperCase()
  // Outward code: 1-2 letters, 1-2 digits, optional trailing letter.
  // Inward code: 1 digit + 2 letters. Total length 5-7.
  const match = cleaned.match(/^([A-Z]{1,2}\d[A-Z\d]?)(\d[A-Z]{2})$/)
  if (!match) return null
  return `${match[1]} ${match[2]}`
}

async function bulkLookup(
  postcodes: string[]
): Promise<Map<string, LatLng>> {
  const out = new Map<string, LatLng>()
  try {
    const res = await fetch(BULK_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ postcodes }),
      // Postcodes.io is fast (typ. < 500 ms). Bail rather than block.
      signal: AbortSignal.timeout(5_000),
    })
    if (!res.ok) return out
    const json = (await res.json()) as {
      result: Array<{
        query: string
        result: { latitude: number; longitude: number } | null
      }>
    }
    for (const row of json.result ?? []) {
      const q = normalisePostcode(row.query)
      if (!q) continue
      if (row.result) {
        out.set(q, { lat: row.result.latitude, lng: row.result.longitude })
      }
    }
  } catch (err) {
    // Network / timeout / DNS — the map just falls back to no coords for
    // these postcodes. Not worth surfacing to the page.
    console.warn('[geocode] bulk lookup failed:', err)
  }
  return out
}
