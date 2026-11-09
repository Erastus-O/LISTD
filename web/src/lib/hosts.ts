/**
 * Production hostnames. One deployment serves both: `www` is the marketing
 * site, `app` is the application. Host routing lives in src/proxy.ts.
 *
 * Kept free of server-only imports so the proxy can share these constants.
 */
export const WWW_HOST = 'www.listd.co.uk'
export const APP_HOST = 'app.listd.co.uk'

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * Origin for links that carry secrets (password-reset token hashes).
 *
 * Never trusts the request's host outright: `req.url` is built from the
 * Host / X-Forwarded-Host headers, which a caller can forge, and a forged
 * host would mail the victim a working token pointing at the attacker.
 * Production always gets the fixed app origin; only local development
 * (localhost) keeps its own origin so the flow can be tested.
 */
export function trustedAppOrigin(requestUrl: string): string {
  const url = new URL(requestUrl)
  if (LOCAL_HOSTNAMES.has(url.hostname)) return url.origin
  return `https://${APP_HOST}`
}

/**
 * Where a "Back to home" link should point for a request on `host`.
 *
 * On the app host, `/` is the role dispatcher (proxy → /post-signin → /auth
 * for signed-out users), so a relative link would bounce straight back to
 * the sign-in page. Send those users to the marketing site instead. Every
 * other host (localhost, Vercel previews) serves marketing at `/` itself.
 */
export function marketingHomeHref(host: string | null | undefined): string {
  return host?.toLowerCase() === APP_HOST ? `https://${WWW_HOST}/` : '/'
}
