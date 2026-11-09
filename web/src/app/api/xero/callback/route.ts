import { sql } from 'drizzle-orm'
import { withServiceRole, xeroConnections } from '@/db'
import { XERO_TOKEN_URL, xeroCallbackUrl } from '@/lib/xero'

export const maxDuration = 30
export const runtime = 'nodejs'

const FRONTEND_BASE = () =>
  process.env.NEXT_PUBLIC_SITE_URL ?? 'https://listd.co.uk'

function redirectTo(qs: string): Response {
  return Response.redirect(`${FRONTEND_BASE()}/xero/callback${qs}`, 302)
}

/**
 * GET /api/xero/callback — Xero OAuth callback.
 * Replaces supabase/functions/xero-callback/index.ts.
 *
 * IMPORTANT: register this URL in the Xero app's "Redirect URIs" list:
 *   `${NEXT_PUBLIC_SITE_URL}/api/xero/callback`
 *
 * The old `/functions/v1/xero-callback` URI must be removed from Xero post-cutover.
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state') // user id (set by /authorize)
    const oauthError = url.searchParams.get('error')

    if (oauthError) {
      console.error('[xero/callback] OAuth error:', oauthError)
      return redirectTo(`?error=${encodeURIComponent(oauthError)}`)
    }
    if (!code || !state) return redirectTo('?error=missing_params')

    const clientId = process.env.XERO_CLIENT_ID
    const clientSecret = process.env.XERO_CLIENT_SECRET
    if (!clientId || !clientSecret) {
      console.error('[xero/callback] credentials not configured')
      return redirectTo('?error=server_config')
    }

    const tokenResponse = await fetch(XERO_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: xeroCallbackUrl(),
      }),
    })

    if (!tokenResponse.ok) {
      console.error(
        '[xero/callback] token exchange failed:',
        await tokenResponse.text()
      )
      return redirectTo('?error=token_exchange')
    }

    const tokens = (await tokenResponse.json()) as {
      access_token: string
      refresh_token: string
      expires_in: number
      scope?: string
    }

    const tenantsResponse = await fetch('https://api.xero.com/connections', {
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        'Content-Type': 'application/json',
      },
    })

    if (!tenantsResponse.ok) {
      console.error('[xero/callback] tenants fetch failed')
      return redirectTo('?error=tenants_fetch')
    }

    const tenants = (await tenantsResponse.json()) as Array<{
      tenantId: string
      tenantName?: string
    }>
    if (!tenants || tenants.length === 0) {
      return redirectTo('?error=no_tenants')
    }

    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString()

    // Service-role bypass: callback is unauthenticated (Xero is calling us)
    // and we're writing per-user rows keyed on `state` (the user's id).
    try {
      await withServiceRole(async (tx) => {
        for (const tenant of tenants) {
          await tx
            .insert(xeroConnections)
            .values({
              userId: state,
              tenantId: tenant.tenantId,
              tenantName: tenant.tenantName ?? tenant.tenantId,
              accessToken: tokens.access_token,
              refreshToken: tokens.refresh_token,
              tokenExpiresAt: expiresAt,
              scopes: tokens.scope ?? '',
            })
            .onConflictDoUpdate({
              target: [xeroConnections.userId, xeroConnections.tenantId],
              set: {
                tenantName: tenant.tenantName ?? tenant.tenantId,
                accessToken: tokens.access_token,
                refreshToken: tokens.refresh_token,
                tokenExpiresAt: expiresAt,
                scopes: tokens.scope ?? '',
                updatedAt: sql`now()`,
              },
            })
        }
      })
    } catch (err) {
      console.error('[xero/callback] storage failed:', err)
      return redirectTo('?error=storage_failed')
    }

    const tenantName = tenants[0].tenantName ?? 'Xero'
    return redirectTo(`?success=true&tenant=${encodeURIComponent(tenantName)}`)
  } catch (err) {
    console.error('[xero/callback] unhandled:', err)
    return redirectTo('?error=unknown')
  }
}
