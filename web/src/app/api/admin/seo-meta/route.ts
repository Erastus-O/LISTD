import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { errorResponse, ok } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import {
  MARKETING_META_PATHS,
  loadSeoOverrides,
  saveSeoOverrides,
  type SeoMetaOverrides,
} from '@/lib/seo-meta'

export const runtime = 'nodejs'

const EntrySchema = z.object({
  path: z.string(),
  /** Empty string = clear the override (fall back to the code default). */
  title: z.string().trim().max(70).optional(),
  description: z.string().trim().max(300).optional(),
  /** Comma-separated keywords → the page's `keywords` meta tag. */
  keywords: z.string().trim().max(300).optional(),
  /** JSON-LD document. Must parse as JSON (object or array) — rejected
   *  otherwise so a typo can't silently drop the page's schema. */
  jsonLd: z
    .string()
    .trim()
    .max(10000)
    .optional()
    .refine(
      (v) => {
        if (!v) return true
        try {
          const parsed = JSON.parse(v)
          return typeof parsed === 'object' && parsed !== null
        } catch {
          return false
        }
      },
      { message: 'JSON-LD Schema must be valid JSON (an object or array).' }
    ),
})
const RequestSchema = z.object({ entries: z.array(EntrySchema).max(50) })

/**
 * POST /api/admin/seo-meta — save per-page SEO overrides (admin only).
 * Replaces the stored blob with the submitted set, busts the cache, and
 * revalidates every marketing path so the changes are visible immediately
 * (the pages are ISR-cached otherwise).
 */
export async function POST(req: Request) {
  const session = await authorizeRequest('admin', 'marketing')
  if (session instanceof Response) return session

  try {
    const { entries } = RequestSchema.parse(await req.json())

    const overrides: SeoMetaOverrides = {}
    for (const e of entries) {
      if (!MARKETING_META_PATHS.includes(e.path)) continue
      const entry: {
        title?: string
        description?: string
        keywords?: string
        jsonLd?: string
      } = {}
      if (e.title) entry.title = e.title
      if (e.description) entry.description = e.description
      if (e.keywords) entry.keywords = e.keywords
      if (e.jsonLd) entry.jsonLd = e.jsonLd
      if (entry.title || entry.description || entry.keywords || entry.jsonLd) {
        overrides[e.path] = entry
      }
    }

    await saveSeoOverrides(overrides, session.userId)

    // Regenerate the static marketing pages so edits show without waiting
    // out the ISR window.
    for (const path of MARKETING_META_PATHS) revalidatePath(path)

    const saved = await loadSeoOverrides()
    return ok({ success: true, overrides: saved })
  } catch (err) {
    return errorResponse(err)
  }
}
