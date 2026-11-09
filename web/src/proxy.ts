import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { APP_HOST, WWW_HOST } from '@/lib/hosts'

/**
 * Proxy (formerly Middleware in Next 15 and earlier).
 *
 * Two responsibilities, in order:
 *
 *   1. **Host routing** — the one deployment serves both hostnames:
 *      `www.listd.co.uk` is the marketing site, `app.listd.co.uk` is the app.
 *      App paths requested on www 308 to app.; marketing paths requested on
 *      app. 308 to www. `/api/*` is served identically on BOTH hosts and is
 *      never redirected (Stripe webhooks + crons treat a 308 as failure).
 *      Inert on localhost / Vercel previews / any other hostname.
 *
 *   2. **Session cookie refresh** — refresh the Supabase session on every
 *      real request so Server Components and Route Handlers see a valid
 *      session. It does NOT enforce authorization — that lives in the DAL
 *      (`src/lib/dal.ts`).
 *
 * Per Next 16 docs: Proxy runs on every prefetch and route. Database calls or
 * heavy logic here will degrade navigation. Keep it to string checks + cookies.
 */

/** Marketing routes — everything the (marketing) group serves. */
const MARKETING_PATHS = new Set([
  '/',
  '/how-it-works',
  '/for-clients',
  '/for-clerks',
  '/for-cleaners',
  '/service-tiers',
  '/about',
  '/contact',
  '/terms',
  '/privacy',
  '/cookies',
])

/** Top-level app segments (everything outside the (marketing) group). A www
 *  request for one of these bounces to the app host. Enumerated explicitly so
 *  unknown paths 404 in place instead of ping-ponging between hosts. */
const APP_PREFIXES = [
  '/auth',
  '/book',
  '/admin',
  '/client',
  '/clerk',
  '/cleaner',
  '/worker',
  '/tenant',
  '/account',
  '/onboarding',
  '/post-signin',
  '/accept-invite',
  '/reset-password',
  '/notifications',
  '/reports',
  '/inspection',
  '/compliance',
  '/early-access',
  '/help',
  '/unauthorized',
  '/xero',
]

/** Paths served as-is on BOTH hosts: API (webhooks/crons must never see a
 *  redirect) and SEO/asset files. */
function isHostAgnostic(pathname: string): boolean {
  return (
    pathname.startsWith('/api/') ||
    pathname === '/sitemap.xml' ||
    pathname === '/robots.txt' ||
    pathname.startsWith('/opengraph-image') ||
    pathname === '/icon.png' ||
    pathname === '/manifest.webmanifest'
  )
}

function hostRoute(request: NextRequest): NextResponse | null {
  const host = request.headers.get('host')?.toLowerCase() ?? ''
  if (host !== WWW_HOST && host !== APP_HOST) return null // localhost/preview

  const { pathname, search } = request.nextUrl

  // app-host robots.txt: the app must never be indexed — serve disallow-all
  // instead of the marketing robots (a redirect here would leak www's
  // allow-list onto the app host).
  if (host === APP_HOST && pathname === '/robots.txt') {
    return NextResponse.rewrite(new URL('/api/robots-app', request.url))
  }
  if (isHostAgnostic(pathname)) return null

  if (host === WWW_HOST) {
    if (APP_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
      return NextResponse.redirect(
        `https://${APP_HOST}${pathname}${search}`,
        308
      )
    }
    return null
  }

  // host === APP_HOST
  if (pathname === '/') {
    // App root → role-aware dispatch (signed-in → dashboard, else /auth).
    return NextResponse.redirect(`https://${APP_HOST}/post-signin`, 308)
  }
  if (MARKETING_PATHS.has(pathname)) {
    return NextResponse.redirect(
      `https://${WWW_HOST}${pathname}${search}`,
      308
    )
  }
  return null
}

export async function proxy(request: NextRequest) {
  const routed = hostRoute(request)
  if (routed) return routed

  let response = NextResponse.next({ request })

  // Next 16 fires this proxy on every prefetch the router does for visible
  // <Link>s. Refreshing the Supabase session on every prefetch turns one nav
  // into 5–10 Supabase auth round-trips, which compounds badly when the
  // network to Supabase is degraded. Cookie-refresh on the *real* request is
  // enough — prefetches inherit whatever cookies the next navigation sees.
  const isPrefetch =
    request.headers.get('next-router-prefetch') === '1' ||
    request.headers.get('purpose') === 'prefetch' ||
    request.headers.get('sec-purpose')?.includes('prefetch')
  if (isPrefetch) return response

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Touching auth.getUser() refreshes the access token if it's near expiry.
  await supabase.auth.getUser()

  return response
}

export const config = {
  matcher: [
    // Run on all routes except static assets and Next internals.
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
