import Link from 'next/link'
import { headers } from 'next/headers'
import { eq } from 'drizzle-orm'
import { Download, FileText, ShieldOff } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { db, jobs, properties } from '@/db'
import { resolveShareToken } from '@/lib/report-share-tokens'
import { getSupabaseAdmin } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Shared inspection report' }

type Props = { params: Promise<{ token: string }> }

const SIGNED_URL_TTL_SECONDS = 60 * 15 // 15 min — long enough to download

/**
 * Public-facing report share page. Validated by token + audited via
 * `report_share_tokens`. No login required — the unguessable token IS
 * the credential. Each visit increments `view_count` and (when capped)
 * eventually flips the row to `view_cap`-rejected state.
 *
 * The page shows: report identity (job ref + property address), and a
 * download button pointing at a short-lived Supabase signed URL minted
 * server-side. The signed URL is regenerated on every page load so the
 * storage path is never exposed in the share URL, and the link is
 * unusable after a few minutes even if intercepted.
 */
export default async function SharedReportPage({ params }: Props) {
  const { token } = await params
  // Reconstruct a Request-shaped object for the resolver's IP / UA capture.
  const h = await headers()
  const req = new Request('https://share.local', {
    headers: new Headers({
      'x-forwarded-for': h.get('x-forwarded-for') ?? '',
      'user-agent': h.get('user-agent') ?? '',
    }),
  })

  const result = await resolveShareToken(token, req)
  if (!result.ok) {
    return <Denied reason={result.reason} />
  }

  // Pull report identity for the page chrome.
  const [job] = await db
    .select({
      id: jobs.id,
      jobRefNumber: jobs.jobRefNumber,
      reportUrl: jobs.reportUrl,
      inspectionType: jobs.inspectionType,
      scheduledDate: jobs.scheduledDate,
      propAddress: properties.addressLine1,
      propCity: properties.city,
      propPostcode: properties.postcode,
    })
    .from(jobs)
    .leftJoin(properties, eq(properties.id, jobs.propertyId))
    .where(eq(jobs.id, result.jobId))
    .limit(1)

  if (!job?.reportUrl) {
    return <Denied reason="unknown" />
  }

  const downloadUrl = await mintSignedUrl(job.reportUrl)
  if (!downloadUrl) {
    return <Denied reason="unknown" />
  }

  const ref = `LST-${String(job.jobRefNumber).padStart(5, '0')}`
  const address =
    [job.propAddress, job.propCity, job.propPostcode]
      .filter(Boolean)
      .join(', ') || 'Inspection report'

  const remainingViews =
    result.row.maxViews !== null
      ? Math.max(0, result.row.maxViews - (result.row.viewCount + 1))
      : null
  const expiresAt = new Date(result.row.expiresAt)

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-6 px-6 py-12">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <FileText className="h-4 w-4" />
        Shared inspection report
      </div>
      <Card>
        <CardContent className="space-y-4 p-6">
          <div>
            <p className="font-mono text-xs uppercase tracking-wide text-muted-foreground">
              {ref}
            </p>
            <h1 className="mt-1 font-semibold text-2xl text-foreground">
              {address}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {job.inspectionType.replace(/_/g, ' ')} · scheduled{' '}
              {job.scheduledDate}
            </p>
          </div>

          <a
            href={downloadUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <Download className="h-4 w-4" />
            Download PDF
          </a>

          <div className="space-y-1 border-t border-border pt-3 text-[11px] text-muted-foreground">
            <p>
              This link expires{' '}
              <span className="text-foreground">
                {expiresAt.toLocaleDateString('en-GB', {
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric',
                })}
              </span>
              .
            </p>
            {remainingViews !== null && (
              <p>
                {remainingViews === 0
                  ? 'This was the last permitted view of this link.'
                  : `${remainingViews} ${remainingViews === 1 ? 'view' : 'views'} remaining.`}
              </p>
            )}
            <p>
              The download URL above is short-lived: refresh this page if it
              stops working.
            </p>
          </div>
        </CardContent>
      </Card>

      <p className="text-center text-[11px] text-muted-foreground">
        Shared via LISTD Pro · <Link href="/" className="hover:underline">listd.pro</Link>
      </p>
    </main>
  )
}

function Denied({ reason }: { reason: string }) {
  const message =
    reason === 'expired'
      ? 'This share link has expired.'
      : reason === 'revoked'
        ? 'This share link has been revoked by the issuer.'
        : reason === 'view_cap'
          ? 'This share link has reached its view limit.'
          : 'This share link is invalid or no longer available.'
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center gap-6 px-6 py-12 text-center">
      <ShieldOff className="h-10 w-10 text-muted-foreground" />
      <h1 className="font-semibold text-2xl text-foreground">
        Link unavailable
      </h1>
      <p className="text-sm text-muted-foreground">{message}</p>
      <p className="text-[11px] text-muted-foreground">
        If you believe this is a mistake, contact the person who shared the
        link with you and ask them to re-issue.
      </p>
    </main>
  )
}

async function mintSignedUrl(reportUrl: string): Promise<string | null> {
  try {
    const parsed = new URL(reportUrl)
    const match = parsed.pathname.match(
      /\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/]+)\/(.+)$/
    )
    if (!match) return null
    const supabaseAdmin = getSupabaseAdmin()
    const { data } = await supabaseAdmin.storage
      .from(match[1])
      .createSignedUrl(decodeURIComponent(match[2]), SIGNED_URL_TTL_SECONDS)
    return data?.signedUrl ?? null
  } catch {
    return null
  }
}
