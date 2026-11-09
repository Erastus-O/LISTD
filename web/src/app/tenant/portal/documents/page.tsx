import { headers } from 'next/headers'
import { FolderOpen } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { rateLimit } from '@/lib/rate-limit'
import { resolveTenantToken } from '@/lib/tenant-tokens'
import { PortalError } from '../_components/portal-error'

export const metadata = { title: 'Tenant Portal · Documents' }
export const dynamic = 'force-dynamic'

type Props = {
  searchParams: Promise<{ token?: string }>
}

/**
 * Tenant portal Documents tab. Currently a placeholder mirroring Lovable's
 * shape — no documents are persisted today. The token resolve + rate limit
 * + audit logging still apply so the tab is treated as a real portal
 * surface rather than a free-access page.
 */
export default async function TenantPortalDocuments({ searchParams }: Props) {
  const sp = await searchParams
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
    'view_documents'
  )
  if (!verdict.ok) return <PortalError reason={verdict.reason} />

  return (
    <div className="space-y-4">
      <h2 className="text-sm font-semibold text-foreground">Documents</h2>
      <Card>
        <CardContent className="py-10 text-center">
          <FolderOpen className="mx-auto mb-2 h-8 w-8 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">No documents shared yet</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Any documents shared by your agent will appear here
          </p>
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
  return new Request('http://internal/tenant/portal/documents', {
    headers: {
      'x-forwarded-for': h.get('x-forwarded-for') ?? '',
      'user-agent': h.get('user-agent') ?? '',
    },
  })
}
