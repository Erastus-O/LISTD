import Link from 'next/link'
import { headers } from 'next/headers'
import { CheckCircle, Clock, Eye, FileText } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { rateLimit } from '@/lib/rate-limit'
import { resolveTenantToken } from '@/lib/tenant-tokens'
import { loadTenantPortalData } from '@/lib/tenant-portal-data'
import { PortalError } from './_components/portal-error'

export const metadata = { title: 'Tenant Portal · My Reports' }
export const dynamic = 'force-dynamic'

type Props = {
  searchParams: Promise<{ token?: string }>
}

const INSPECTION_LABELS: Record<string, string> = {
  new_inventory: 'New Inventory',
  check_in: 'Check-In',
  check_out: 'Check-Out',
  mid_term: 'Mid-Term',
  interim: 'Interim',
}

/**
 * Tenant portal home — list of reports for the tenant's job. Token-validated;
 * rate-limited per IP (M3 #9).
 */
export default async function TenantPortalHome({ searchParams }: Props) {
  const sp = await searchParams
  const ip = await getCallerIp()

  // M3 #9 rate limit. Disabled (passes through) when KV env vars aren't set.
  const limit = await rateLimit({
    scope: 'tenant-portal',
    identifier: ip ?? 'anon',
    limit: 30,
    windowSeconds: 60,
  })
  if (!limit.allowed) {
    return <PortalError reason="rate_limit" />
  }

  // Build a fake Request shim so resolveTenantToken can capture IP/UA from
  // headers consistently with the API-handler call sites.
  const req = await synthesizeRequest()
  const verdict = await resolveTenantToken(
    sp.token ?? null,
    'view_report',
    req,
    'view_home'
  )
  if (!verdict.ok) {
    return <PortalError reason={verdict.reason} />
  }

  const data = await loadTenantPortalData({
    jobId: verdict.jobId,
    tenantDetailId: verdict.tenantDetailId,
  })

  const address = [
    data.property?.addressLine1,
    data.property?.city,
    data.property?.postcode,
  ]
    .filter(Boolean)
    .join(', ')

  const job = data.job
  const inspectionLabel = job
    ? INSPECTION_LABELS[job.inspectionType] ?? job.inspectionType
    : 'Inspection'

  const tokenQs = sp.token ? `?token=${encodeURIComponent(sp.token)}` : ''

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-bold text-foreground">
          Welcome, {data.tenant?.fullName ?? 'Tenant'}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{address || '—'}</p>
        {job && (
          <p className="mt-0.5 text-xs text-muted-foreground">
            {inspectionLabel} · {formatDate(job.scheduledDate)}
          </p>
        )}
      </div>

      <div>
        <h2 className="mb-3 text-sm font-semibold text-foreground">Your Reports</h2>
        {data.reports.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center">
              <FileText className="mx-auto mb-2 h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">
                No reports available yet
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Reports will appear here once your inspection is complete
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {data.reports.map((report) => {
              const isSigned = !!report.signedAt
              return (
                <Card key={report.id} className="transition-shadow hover:shadow-sm">
                  <CardContent className="flex items-center justify-between gap-3 p-4">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground">
                        {inspectionLabel} Report
                      </p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {report.generatedAt
                          ? `Generated ${formatDateTime(report.generatedAt)}`
                          : 'Generation date unknown'}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge
                        variant={isSigned ? 'secondary' : 'outline'}
                        className="text-[10px]"
                      >
                        {isSigned ? (
                          <>
                            <CheckCircle className="mr-1 h-3 w-3" />
                            Signed
                          </>
                        ) : (
                          <>
                            <Clock className="mr-1 h-3 w-3" />
                            Awaiting Signature
                          </>
                        )}
                      </Badge>
                      <Link href={`/tenant/portal/report/${report.id}${tokenQs}`}>
                        <Button variant="outline" size="sm" className="text-xs">
                          <Eye className="mr-1 h-3.5 w-3.5" />
                          View
                        </Button>
                      </Link>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )}
      </div>
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

/**
 * Build a minimal `Request` shim from `next/headers` so `resolveTenantToken`
 * can capture the IP / UA consistently with API-handler call sites that
 * already receive a real `Request` object.
 */
async function synthesizeRequest(): Promise<Request> {
  const h = await headers()
  return new Request('http://internal/tenant/portal', {
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
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
