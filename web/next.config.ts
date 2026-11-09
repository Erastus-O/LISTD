import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { NextConfig } from 'next'

// Pin Turbopack's workspace root to this package, otherwise Next walks up
// and picks the parent Lovable repo's package-lock.json by mistake.
const projectRoot = dirname(fileURLToPath(import.meta.url))

const nextConfig: NextConfig = {
  turbopack: {
    root: projectRoot,
  },
  // Marketing hero photography is served from Unsplash's CDN and optimised
  // through next/image.
  images: {
    remotePatterns: [{ protocol: 'https', hostname: 'images.unsplash.com' }],
  },
  // The /help pages read role-scoped markdown guides at runtime via fs.
  // Static analysis can't see those reads, so tell Next to copy the
  // content/guides/ directory into the serverless function trace — without
  // this the files aren't on disk in the Vercel deployment and every
  // /help/<slug> 404s.
  outputFileTracingIncludes: {
    '/help': ['./content/guides/**/*'],
    '/help/*': ['./content/guides/**/*'],
  },
  async redirects() {
    // Preserve legacy URLs from the Lovable React Router setup so existing
    // client links and bookmarks keep working post-cutover.
    return [
      // Short URLs used by the new website copy; canonical pages keep their
      // existing paths so SEO and links in the wild don't change.
      { source: '/pricing', destination: '/service-tiers', permanent: false },
      { source: '/pros', destination: '/for-clerks', permanent: false },
      { source: '/login', destination: '/auth', permanent: false },
      { source: '/signup', destination: '/auth', permanent: false },
      // S4d cutover (M1 #12): `/book` is the canonical client booking entry;
      // the legacy 7-step `/client/jobs/new` is retired. 307 (temporary) so
      // we can safely remove the rule after the 90-day bake-in per the PRD
      // §11 M1 exit criterion — 308/301 would be browser-cached and outlast
      // the route.
      { source: '/client/jobs/new', destination: '/book', permanent: false },
      { source: '/dashboard', destination: '/client/dashboard', permanent: false },
      { source: '/dashboard/:path*', destination: '/client/dashboard', permanent: false },
      { source: '/admin/super/:path*', destination: '/admin/dashboard', permanent: false },
    ]
  },
}

export default nextConfig
