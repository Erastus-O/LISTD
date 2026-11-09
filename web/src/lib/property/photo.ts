import 'server-only'
import { signStoredAssetUrl } from '@/lib/storage/download'

/**
 * `property-photos` is a PRIVATE bucket (0039), but what we persist on
 * `properties.image_url` is the public-form URL — the same shape
 * `job-photos` stores. Hitting that path on a private bucket 404s, so
 * every feed that renders a thumbnail has to re-sign first.
 *
 * Signing is one network call per distinct URL, so feeds batch through
 * `signPropertyPhotos` rather than signing per row: a 50-job Available
 * page with a handful of repeat properties collapses to a handful of
 * calls. A failed sign yields `null` and the card falls back to its
 * placeholder — a broken thumbnail must never take the feed down.
 */

const THUMBNAIL_TTL_SECONDS = 60 * 60

/** Map of stored URL → signed URL, for the distinct non-null inputs. */
export async function signPropertyPhotos(
  storedUrls: Array<string | null | undefined>
): Promise<Map<string, string>> {
  const distinct = Array.from(
    new Set(storedUrls.filter((u): u is string => Boolean(u)))
  )
  const out = new Map<string, string>()
  await Promise.all(
    distinct.map(async (url) => {
      try {
        const signed = await signStoredAssetUrl(url, THUMBNAIL_TTL_SECONDS)
        if (signed) out.set(url, signed)
      } catch {
        // Leave it out of the map — callers render the placeholder.
      }
    })
  )
  return out
}

/** Single-photo convenience for detail screens. */
export async function signPropertyPhoto(
  storedUrl: string | null | undefined
): Promise<string | null> {
  if (!storedUrl) return null
  const map = await signPropertyPhotos([storedUrl])
  return map.get(storedUrl) ?? null
}
