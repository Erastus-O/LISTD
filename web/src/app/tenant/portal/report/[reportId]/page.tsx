import { headers } from 'next/headers'
import { eq } from 'drizzle-orm'
import { AlertTriangle, CheckCircle, Download } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { generatedReports, withServiceRole } from '@/db'
import { rateLimit } from '@/lib/rate-limit'
import { signStoredAssetUrl } from '@/lib/storage/download'
import { resolveTenantToken } from '@/lib/tenant-tokens'
import { loadTenantPortalData } from '@/lib/tenant-portal-data'
import { loadTenantReportDetail } from '@/lib/tenant-report-detail'
import { PortalError } from '../../_components/portal-error'
import { SignForm } from './sign-form'

export const metadata = { title: 'Tenant Portal · Report' }
export const dynamic = 'force-dynamic'

type Props = {
  params: Promise<{ reportId: string }>
  searchParams: Promise<{ token?: string }>
}

const CONDITION_TONE: Record<string, string> = {
  good: 'bg-success/10 text-success',
  fair: 'bg-warning/10 text-warning',
  poor: 'bg-destructive/10 text-destructive',
  na: 'bg-muted text-muted-foreground',
}

export default async function TenantReportPage({ params, searchParams }: Props) {
  const [{ reportId }, sp] = await Promise.all([params, searchParams])
  const ip = await getCallerIp()

  const limit = await rateLimit({
    scope: 'tenant-portal',
    identifier: ip ?? 'anon',
    limit: 30,
    windowSeconds: 60,
  })
  if (!limit.allowed) return <PortalError reason="rate_limit" />

  const req = await synthesizeRequest()
  const verdict = await resolveTenantToken(
    sp.token ?? null,
    'view_report',
    req,
    'view_report_detail'
  )
  if (!verdict.ok) return <PortalError reason={verdict.reason} />

  // Cross-check the report belongs to this token's job before loading detail.
  // Prevents a tenant from one job poking at another job's report id.
  const [reportRow] = await withServiceRole((tx) =>
    tx
      .select({
        id: generatedReports.id,
        jobId: generatedReports.jobId,
        generatedAt: generatedReports.generatedAt,
        reportUrl: generatedReports.reportUrl,
        tenantSignature: generatedReports.tenantSignature,
        signedAt: generatedReports.signedAt,
      })
      .from(generatedReports)
      .where(eq(generatedReports.id, reportId))
      .limit(1)
  )

  if (!reportRow || reportRow.jobId !== verdict.jobId) {
    // Mismatch is the equivalent of a wrong-scope: the token doesn't grant
    // access to this report. Use the same error UX.
    return <PortalError reason="wrong_scope" />
  }

  const [data, rooms] = await Promise.all([
    loadTenantPortalData({
      jobId: verdict.jobId,
      tenantDetailId: verdict.tenantDetailId,
    }),
    loadTenantReportDetail(verdict.jobId),
  ])

  const address = [
    data.property?.addressLine1,
    data.property?.city,
    data.property?.postcode,
  ]
    .filter(Boolean)
    .join(', ')

  // Items needing attention = condition fair / poor.
  const attentionItems = rooms.flatMap((room) =>
    room.items
      .filter((i) => i.condition === 'fair' || i.condition === 'poor')
      .map((i) => ({ ...i, roomName: room.roomName }))
  )

  const isSigned = !!reportRow.signedAt
  // `generated-reports` is private — mint a short-lived signed URL rather
  // than handing out the stored public-form URL (which 404s). The tenant is
  // already token-authorized at this point.
  const reportPdfUrl = reportRow.reportUrl
    ? await signStoredAssetUrl(reportRow.reportUrl)
    : null
  const expectedSignature = (data.tenant?.fullName ?? '').trim()

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-bold text-foreground">Condition Report</h1>
          <p className="text-sm text-muted-foreground">{address || '—'}</p>
          {reportRow.generatedAt && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              Generated {formatDate(reportRow.generatedAt)}
            </p>
          )}
        </div>
        {reportPdfUrl && (
          <a
            href={reportPdfUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md border border-border bg-background px-3 text-xs hover:bg-muted"
          >
            <Download className="h-3.5 w-3.5" />
            PDF
          </a>
        )}
      </div>

      {/* Rooms */}
      {rooms.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No room-level inspection data has been recorded for this report.
          </CardContent>
        </Card>
      ) : (
        rooms.map((room) => (
          <Card key={room.id}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">
                {room.roomName}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {room.items.length === 0 ? (
                <p className="text-xs italic text-muted-foreground">
                  No items recorded
                </p>
              ) : (
                room.items.map((item) => (
                  <div
                    key={item.id}
                    className="rounded-lg border border-border p-3"
                  >
                    <div className="mb-1 flex items-center justify-between">
                      <p className="text-sm font-medium text-foreground">
                        {item.itemName}
                      </p>
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] capitalize ${
                          CONDITION_TONE[item.condition ?? 'na']
                        }`}
                      >
                        {item.condition ?? 'N/A'}
                      </span>
                    </div>
                    {item.notes && (
                      <p className="mb-2 text-xs text-muted-foreground">
                        {item.notes}
                      </p>
                    )}
                    {item.photos.length > 0 && (
                      <div className="grid grid-cols-3 gap-1.5">
                        {item.photos.map((photo) => (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img
                            key={photo.id}
                            src={photo.photoUrl}
                            alt={item.itemName}
                            loading="lazy"
                            className="h-20 w-full rounded border border-border object-cover"
                          />
                        ))}
                      </div>
                    )}
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        ))
      )}

      {/* Items requiring attention */}
      {attentionItems.length > 0 && (
        <Card className="border-warning/30">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-1.5 text-sm font-semibold">
              <AlertTriangle className="h-4 w-4 text-warning" />
              Items Requiring Attention
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              {attentionItems.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between py-1 text-xs"
                >
                  <span className="text-foreground">
                    {item.roomName} : {item.itemName}
                  </span>
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-[9px] capitalize ${
                      CONDITION_TONE[item.condition ?? 'na']
                    }`}
                  >
                    {item.condition}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Signature section */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">
            Tenant Signature
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isSigned ? (
            <div className="rounded-lg bg-success/5 p-4 text-center">
              <CheckCircle className="mx-auto mb-2 h-6 w-6 text-success" />
              <p className="text-sm font-medium text-foreground">
                Signed by {reportRow.tenantSignature}
              </p>
              <p className="text-xs text-muted-foreground">
                {reportRow.signedAt && formatDateTime(reportRow.signedAt)}
              </p>
              {(verdict.row?.scope.includes('view_report') ||
                verdict.usingLegacy) &&
                !isSigned && (
                  <Badge variant="outline" className="mt-2 text-[10px]">
                    Read-only access continues
                  </Badge>
                )}
            </div>
          ) : (
            <SignForm
              reportId={reportRow.id}
              token={sp.token ?? ''}
              expectedSignature={expectedSignature}
            />
          )}
        </CardContent>
      </Card>
    </div>
  )
}

async function getCallerIp(): Promise<string | null> {
  const h = await headers()
  const fwd = h.get('x-forwarded-for')
  if (fwd) {
    const first = fwd.split(',')[0]?.trim()
    if (first) return first
  }
  return h.get('x-real-ip')
}

async function synthesizeRequest(): Promise<Request> {
  const h = await headers()
  return new Request('http://internal/tenant/portal/report', {
    headers: {
      'x-forwarded-for': h.get('x-forwarded-for') ?? '',
      'user-agent': h.get('user-agent') ?? '',
    },
  })
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
