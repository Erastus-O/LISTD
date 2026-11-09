import type { GenerateLinkProperties } from '@supabase/supabase-js'

/**
 * The link we email for a password reset.
 *
 * Supabase's own `action_link` points at `/auth/v1/verify`, which consumes the
 * one-time token on the first GET. Email security scanners (Microsoft Safe
 * Links, Mimecast, university and corporate gateways) open every link in an
 * incoming message, so they burn the token before the user clicks and the
 * user only ever sees "Email link is invalid or has expired".
 *
 * Instead we link to our own /reset-password page with the token hash. The
 * page only calls `verifyOtp()` when the user presses a button, which
 * scanners don't do.
 *
 * `origin` MUST come from trustedAppOrigin() (lib/hosts), never a
 * caller-supplied URL or raw request host: the token hash travels in the
 * link, so pointing it at another host would hand that host a usable reset
 * token.
 */
export function buildRecoveryLink(
  origin: string,
  properties: GenerateLinkProperties | undefined
): string | null {
  if (properties?.hashed_token) {
    const url = new URL('/reset-password', origin)
    url.searchParams.set('token_hash', properties.hashed_token)
    url.searchParams.set('type', 'recovery')
    return url.toString()
  }
  // Older auth servers without hashed_token: fall back to Supabase's link.
  return properties?.action_link ?? null
}
