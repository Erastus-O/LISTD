import type { MetadataRoute } from 'next'

const BASE = 'https://www.listd.co.uk'

/**
 * XML sitemap — the public marketing pages only. Authenticated app surfaces
 * are deliberately absent (and disallowed in robots.ts). Served at
 * /sitemap.xml. Update when a marketing page is added or retired.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const page = (
    path: string,
    priority: number,
    changeFrequency: MetadataRoute.Sitemap[number]['changeFrequency'] = 'monthly'
  ) => ({
    url: `${BASE}${path}`,
    lastModified: new Date(),
    changeFrequency,
    priority,
  })

  return [
    page('/', 1, 'weekly'),
    page('/how-it-works', 0.9),
    page('/for-clients', 0.9),
    page('/for-clerks', 0.9),
    page('/for-cleaners', 0.9),
    page('/service-tiers', 0.8),
    page('/about', 0.6),
    page('/contact', 0.6),
    page('/careers', 0.6, 'weekly'),
    page('/terms', 0.3, 'yearly'),
    page('/privacy', 0.3, 'yearly'),
    page('/cookies', 0.3, 'yearly'),
  ]
}
