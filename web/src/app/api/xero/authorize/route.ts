import { errorResponse, ok, serverError } from '@/lib/api'
import { authorizeRequest } from '@/lib/dal'
import { xeroCallbackUrl } from '@/lib/xero'

export const maxDuration = 10
export const runtime = 'nodejs'

const XERO_SCOPES = [
  'openid',
  'profile',
  'email',
  'accounting.transactions',
  'accounting.contacts',
  'accounting.reports.read',
  'accounting.settings',
  'offline_access',
].join(' ')

/**
 * GET /api/xero/authorize — generates the Xero OAuth authorize URL.
 * Replaces supabase/functions/xero-authorize/index.ts.
 */
export async function GET() {
  const session = await authorizeRequest()
  if (session instanceof Response) return session

  try {
    const clientId = process.env.XERO_CLIENT_ID
    if (!clientId) return serverError('XERO_CLIENT_ID is not configured')

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: xeroCallbackUrl(),
      scope: XERO_SCOPES,
      state: session.userId,
    })

    const url = `https://login.xero.com/identity/connect/authorize?${params.toString()}`
    return ok({ url })
  } catch (err) {
    return errorResponse(err)
  }
}
