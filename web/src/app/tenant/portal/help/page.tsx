import { headers } from 'next/headers'
import { BookOpen } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Card, CardContent } from '@/components/ui/card'
import { rateLimit } from '@/lib/rate-limit'
import { resolveTenantToken } from '@/lib/tenant-tokens'
import { loadTenantGuide } from '@/lib/guides'
import { PortalError } from '../_components/portal-error'

export const metadata = { title: 'Tenant Portal · Help' }
export const dynamic = 'force-dynamic'

type Props = {
  searchParams: Promise<{ token?: string }>
}

/**
 * Tenant portal Help tab. Tenants aren't a Supabase app_role, so they
 * can't use `/help/<slug>` (which is gated by `requireSession`). Instead
 * we render the tenant guide here, behind the same token + rate limit +
 * audit guard the other portal tabs use — so help is a real portal
 * surface and follows the same access rules as reports/documents.
 */
export default async function TenantPortalHelp({ searchParams }: Props) {
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
    'view_help'
  )
  if (!verdict.ok) return <PortalError reason={verdict.reason} />

  const guide = await loadTenantGuide()
  if (!guide) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-sm text-muted-foreground">
          The tenant guide is not available right now. Please try again later.
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <header className="space-y-2">
        <div className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          <BookOpen className="h-4 w-4" />
          Help
        </div>
        <h2 className="text-xl font-semibold text-foreground">{guide.title}</h2>
        <p className="text-sm text-muted-foreground">{guide.summary}</p>
        {guide.updated && (
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Last updated {guide.updated}
          </p>
        )}
      </header>
      <article className="prose prose-sm max-w-none dark:prose-invert">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
          {guide.content}
        </ReactMarkdown>
      </article>
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
  return new Request('http://internal/tenant/portal/help', {
    headers: {
      'x-forwarded-for': h.get('x-forwarded-for') ?? '',
      'user-agent': h.get('user-agent') ?? '',
    },
  })
}
