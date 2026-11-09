/**
 * GET /api/robots-app — disallow-all robots.txt for the app host.
 *
 * The proxy rewrites `app.listd.co.uk/robots.txt` here so the app subdomain
 * is never crawled. The marketing host keeps the generated /robots.txt from
 * src/app/robots.ts (which allows the marketing pages).
 */
export function GET() {
  return new Response('User-agent: *\nDisallow: /\n', {
    headers: {
      'Content-Type': 'text/plain',
      'Cache-Control': 'public, max-age=3600',
    },
  })
}
