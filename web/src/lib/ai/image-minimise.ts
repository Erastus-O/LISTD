import 'server-only'
import sharp from 'sharp'

/**
 * Data-minimisation for images before they're sent to the third-party AI
 * provider. Inspection photos from phones carry EXIF (GPS coordinates, device
 * id, timestamp) and are full resolution — more personal data than the model
 * needs to draft a description.
 *
 * `minimiseImageForAi` fetches the original, **strips all metadata** (EXIF is
 * dropped on re-encode), **downscales** to a bounded dimension, re-encodes
 * JPEG, and returns a base64 **data URL**. Sending the bytes inline (rather
 * than our storage URL) also means OpenRouter / the downstream provider never
 * fetches anything from our private bucket.
 *
 * Best-effort: callers fall back to the original URL if this throws, so AI
 * assist still works even when an image can't be processed.
 */

const MAX_DIM = 1024 // px — plenty for item/condition drafting
const JPEG_QUALITY = 80
const FETCH_TIMEOUT_MS = 15_000

export async function minimiseImageForAi(imageUrl: string): Promise<string> {
  const res = await fetch(imageUrl, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!res.ok) {
    throw new Error(`image fetch failed: ${res.status}`)
  }
  const input = Buffer.from(await res.arrayBuffer())
  const out = await sharp(input)
    // Bake EXIF orientation in BEFORE the metadata is dropped, so the image
    // isn't sideways once we strip it.
    .rotate()
    .resize({
      width: MAX_DIM,
      height: MAX_DIM,
      fit: 'inside',
      withoutEnlargement: true,
    })
    // Re-encode without metadata (sharp only keeps EXIF if withMetadata()).
    .jpeg({ quality: JPEG_QUALITY })
    .toBuffer()
  return `data:image/jpeg;base64,${out.toString('base64')}`
}
