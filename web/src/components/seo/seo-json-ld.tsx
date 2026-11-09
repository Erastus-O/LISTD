import { loadJsonLdForPath } from '@/lib/seo-meta'

/**
 * Inline JSON-LD structured data for a marketing page, edited per page on
 * /admin/seo. Server component — the script is in the SSR HTML so crawlers
 * see it without executing JS. Renders nothing when the page has no schema.
 * The payload is re-serialised with `<` escaped by `loadJsonLdForPath`, so
 * dangerouslySetInnerHTML here cannot be broken out of.
 */
export async function SeoJsonLd({ path }: { path: string }) {
  const json = await loadJsonLdForPath(path)
  if (!json) return null
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: json }}
    />
  )
}
