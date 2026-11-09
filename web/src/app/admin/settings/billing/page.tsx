import Link from 'next/link'
import { ArrowLeft, CheckCircle2, ExternalLink, Plug, XCircle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { requireRole } from '@/lib/dal'
import { loadBillingProviderId } from '@/lib/billing/select'
import { isXeroConnected } from '@/lib/billing/xero/access'
import { BillingProviderForm } from './_components/billing-provider-form'

export const metadata = { title: 'Admin · Billing provider' }
export const dynamic = 'force-dynamic'

/**
 * Billing provider toggle. Reads `platform_settings.invoice_provider`,
 * lets admin flip between `inbuilt` (first-party generator) and `xero`
 * (currently a stub).
 *
 * Cross-linked from /admin/settings and from the empty-state on
 * /admin/invoices when the active provider isn't `inbuilt`.
 */
export default async function AdminBillingProviderPage() {
  await requireRole('admin')
  const [current, xeroConnected] = await Promise.all([
    loadBillingProviderId(),
    isXeroConnected(),
  ])

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 px-6 py-10">
      <Link
        href="/admin/settings"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to settings
      </Link>

      <div className="flex items-center gap-2">
        <Plug className="h-6 w-6 text-muted-foreground" />
        <div>
          <h1 className="font-display text-3xl text-foreground">
            Billing provider
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Choose which backend serves invoices. Switching is non-destructive
            : existing invoices keep their original provider behaviour.
          </p>
        </div>
      </div>

      <Card>
        <CardContent className="p-6">
          <BillingProviderForm initial={current} />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 p-6">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-foreground">
              Xero connection
            </h2>
            {xeroConnected ? (
              <Badge variant="secondary" className="gap-1">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Connected
              </Badge>
            ) : (
              <Badge variant="outline" className="gap-1">
                <XCircle className="h-3.5 w-3.5" />
                Not connected
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {xeroConnected
              ? 'A Xero account is connected. Switching the provider to Xero will route new invoice actions through it.'
              : 'Connect a Xero account before switching the active provider to Xero. The connection token is stored per-admin; one admin’s connection serves the whole organisation.'}
          </p>
          <Button asChild size="sm" variant="outline" className="gap-1.5">
            <a href="/api/xero/authorize">
              <ExternalLink className="h-3.5 w-3.5" />
              {xeroConnected ? 'Reconnect Xero' : 'Connect Xero'}
            </a>
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-2 p-6 text-xs text-muted-foreground">
          <h2 className="text-sm font-semibold text-foreground">About</h2>
          <p>
            <strong className="text-foreground">Inbuilt</strong> : LISTD&rsquo;s
            first-party invoice generator. Renders PDF locally, emails via
            Resend, stores in Supabase storage. The default and most fully
            featured option today.
          </p>
          <p>
            <strong className="text-foreground">Xero</strong> : outbound
            integration with Xero&rsquo;s invoicing API. Dual-writes to Xero
            (source of truth) and a local shadow row (so the LISTD list /
            detail pages stay fast). Xero handles the PDF, the email, and the
            embedded &ldquo;Pay now&rdquo; link if you&rsquo;ve configured one
            in Xero. Switch here only after you&rsquo;ve connected a Xero
            account above and mapped at least one tax rate to a Xero
            <span className="font-mono"> TaxType</span> at{' '}
            <Link href="/admin/settings/tax" className="text-primary hover:underline">
              Settings → Tax
            </Link>.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
