import { authorizeRequest } from '@/lib/dal'
import {
  INSURANCE_CERT_BASE64,
  INSURANCE_CERT_CONTENT_TYPE,
} from '@/lib/legal/insurance-cert'

export const runtime = 'nodejs'

/**
 * GET /api/compliance/insurance — streams the business Professional Indemnity
 * Insurance certificate as an image, for **authenticated users only**.
 *
 * Deliberately serves a rasterised image, never the source PDF, and exposes no
 * download affordance. This makes casual saving inconvenient (no file, no
 * download button) — it does not, and cannot, prevent screenshots. `no-store`
 * keeps it out of shared/proxy caches.
 */
export async function GET() {
  const session = await authorizeRequest()
  if (session instanceof Response) return session

  const bytes = Buffer.from(INSURANCE_CERT_BASE64, 'base64')
  return new Response(new Uint8Array(bytes), {
    headers: {
      'Content-Type': INSURANCE_CERT_CONTENT_TYPE,
      'Content-Length': String(bytes.length),
      'Content-Disposition': 'inline',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
