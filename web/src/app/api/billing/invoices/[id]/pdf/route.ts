import { and, eq } from 'drizzle-orm'
import { db, invoices, organisationMembers } from '@/db'
import { getSession } from '@/lib/dal'
import { signStoredAssetUrl } from '@/lib/storage/download'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SIGNED_TTL_SECONDS = 60 * 60 // 1 hour

type Params = Promise<{ id: string }>

/**
 * GET /api/billing/invoices/[id]/pdf — authorize the caller against the
 * invoice, then 302-redirect to a freshly signed URL for its PDF.
 *
 * Why this exists: the `invoices` bucket is *private*
 * (`sql/invoices_bucket.sql`), but `invoices.pdf_url` is a public-form URL that
 * 404s ("Bucket not found"). Every viewer (admin / owning client / org member)
 * links here instead of the raw URL, so a single place handles authorization +
 * short-lived signing. Mirrors `/api/reports/[jobId]/view`.
 */
export async function GET(_req: Request, { params }: { params: Params }) {
  const session = await getSession()
  if (!session) return new Response('Unauthorized', { status: 401 })

  const { id } = await params

  const [inv] = await db
    .select({
      clientId: invoices.clientId,
      organisationId: invoices.organisationId,
      pdfUrl: invoices.pdfUrl,
    })
    .from(invoices)
    .where(eq(invoices.id, id))
    .limit(1)

  if (!inv || !inv.pdfUrl) {
    return new Response('Invoice PDF not found', { status: 404 })
  }

  const uid = session.userId
  let allowed = session.roles.includes('admin') || inv.clientId === uid

  if (!allowed && inv.organisationId) {
    const [member] = await db
      .select({ id: organisationMembers.id })
      .from(organisationMembers)
      .where(
        and(
          eq(organisationMembers.organisationId, inv.organisationId),
          eq(organisationMembers.userId, uid),
          eq(organisationMembers.status, 'active')
        )
      )
      .limit(1)
    allowed = Boolean(member)
  }

  if (!allowed) return new Response('Forbidden', { status: 403 })

  const signed = await signStoredAssetUrl(inv.pdfUrl, SIGNED_TTL_SECONDS)
  if (!signed) {
    return new Response('Could not generate invoice link', { status: 500 })
  }

  return new Response(null, {
    status: 302,
    headers: { Location: signed, 'Cache-Control': 'no-store' },
  })
}
