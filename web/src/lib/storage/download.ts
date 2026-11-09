import 'server-only'
import { getSupabaseAdmin } from '@/lib/supabase/admin'

/**
 * Download bytes from a Supabase storage URL via the admin client (bypasses
 * RLS so private buckets work). For non-Supabase URLs, falls back to plain
 * fetch so externally-hosted assets still resolve.
 *
 * Returns `null` if neither path produces bytes.
 *
 * Used by:
 *   - `lib/signed-pdf-pipeline.ts` to fetch the original report PDF +
 *     signature images for the tenant-signed re-render.
 *   - `lib/inspection/route.ts` (clerk inspection submit) to fetch
 *     photo bytes uploaded browser-direct before embedding into the PDF.
 */
/**
 * True only for an inspection photo in this job's own folder. Report submission
 * downloads these with the privileged storage client, so an unchecked URL could
 * read another tenant's files, or (via the fetch fallback below) make the server
 * request any address.
 */
export function isJobPhotoUrl(url: string, jobId: string): boolean {
  const parsed = parseSupabaseStorageUrl(url)
  if (!parsed || parsed.bucket !== 'generated-reports') return false
  const segments = parsed.path.split('/')
  return segments[0] === jobId && segments.length > 1 && !segments.includes('..') && !segments.includes('.')
}

export async function downloadStorageBytes(
  url: string
): Promise<Uint8Array | null> {
  const parsed = parseSupabaseStorageUrl(url)
  if (parsed) {
    const supabaseAdmin = getSupabaseAdmin()
    const { data, error } = await supabaseAdmin.storage
      .from(parsed.bucket)
      .download(parsed.path)
    if (error || !data) return null
    const buf = await data.arrayBuffer()
    return new Uint8Array(buf)
  }
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const buf = await res.arrayBuffer()
    return new Uint8Array(buf)
  } catch {
    return null
  }
}

/**
 * Mint a fresh signed URL for a stored report/asset URL.
 *
 * The `generated-reports` bucket is private (see
 * `sql/generated_reports_bucket.sql`), but historically the app stored a
 * **public-form** URL (`getPublicUrl`) in `jobs.report_url` /
 * `generated_reports.report_url`. Hitting that public path on a private
 * bucket returns `404 Bucket not found`. This helper extracts the
 * bucket+path from whatever form was stored (public or signed) and signs it
 * afresh via the service-role client, so callers can hand the result to an
 * already-authorized user.
 *
 * Returns:
 *   - a freshly signed URL on success,
 *   - the original URL unchanged when it isn't a Supabase storage URL
 *     (externally hosted assets still resolve),
 *   - `null` when signing fails.
 */
export async function signStoredAssetUrl(
  storedUrl: string,
  ttlSeconds = 60 * 60
): Promise<string | null> {
  const parsed = parseSupabaseStorageUrl(storedUrl)
  if (!parsed) return storedUrl
  const supabaseAdmin = getSupabaseAdmin()
  const { data, error } = await supabaseAdmin.storage
    .from(parsed.bucket)
    .createSignedUrl(parsed.path, ttlSeconds)
  if (error || !data?.signedUrl) return null
  return data.signedUrl
}

/**
 * Extract bucket + path from a Supabase storage URL. Supports both public
 * (`/storage/v1/object/public/<bucket>/<path>`) and signed
 * (`/storage/v1/object/sign/<bucket>/<path>?token=…`) URL forms.
 */
export function parseSupabaseStorageUrl(
  url: string
): { bucket: string; path: string } | null {
  try {
    const u = new URL(url)
    const m = u.pathname.match(
      /\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/]+)\/(.+)$/
    )
    if (!m) return null
    return { bucket: m[1], path: decodeURIComponent(m[2]) }
  } catch {
    return null
  }
}

/**
 * Best-effort content-type hint from the URL extension. The render pipelines
 * use this only as a fallback when the storage download didn't surface a
 * Content-Type — pdf-lib still sniffs the magic bytes when neither is present.
 */
export function contentTypeFromUrl(url: string): string | null {
  const ext = url.split('?')[0].split('.').pop()?.toLowerCase() ?? null
  if (!ext) return null
  if (ext === 'png') return 'image/png'
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
  if (ext === 'webp') return 'image/webp'
  return null
}
