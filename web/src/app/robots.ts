import type { MetadataRoute } from 'next'

/**
 * robots.txt — allow the public marketing site, keep crawlers out of the
 * authenticated app surfaces (which redirect to /auth for anonymous visitors
 * anyway, but shouldn't be crawled or waste crawl budget) and transactional
 * flows. Served at /robots.txt.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/api/',
          '/admin/',
          '/client/',
          '/clerk/',
          '/cleaner/',
          '/worker/',
          '/tenant/',
          '/account/',
          '/onboarding/',
          '/book',
          '/auth',
          '/post-signin',
          '/accept-invite',
          '/reset-password',
          '/notifications',
          '/reports/',
          '/inspection/',
          '/compliance',
          '/early-access',
          '/xero/',
        ],
      },
    ],
    sitemap: 'https://www.listd.co.uk/sitemap.xml',
  }
}
