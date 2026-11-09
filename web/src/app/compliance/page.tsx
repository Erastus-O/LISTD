import Link from 'next/link'
import { ArrowLeft, ShieldCheck } from 'lucide-react'
import { requireSession } from '@/lib/dal'
import { InsuranceCertView } from '@/components/legal/insurance-cert-view'

export const metadata = { title: 'Insurance & compliance' }
export const dynamic = 'force-dynamic'

/**
 * Authenticated "Insurance & compliance" page. Any signed-in user can view the
 * business Professional Indemnity / Public Liability certificate here. It's
 * shown view-only (see InsuranceCertView) — no PDF, no download button.
 */
export default async function CompliancePage() {
  // Gate on a session — redirects unauthenticated visitors away. The cert is
  // for signed-in users only.
  await requireSession()

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-6 py-10">
      <div>
        <Link
          href="/post-signin"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to your dashboard
        </Link>
        <h1 className="mt-3 flex items-center gap-2 font-display text-3xl text-foreground">
          <ShieldCheck className="h-6 w-6 text-primary" />
          Insurance &amp; compliance
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          LISTD operates under professional indemnity and public liability
          insurance. The current certificate is shown below for your records.
        </p>
      </div>

      <InsuranceCertView />

      <p className="text-xs text-muted-foreground">
        Provided for viewing only. For a countersigned copy or verification,
        contact{' '}
        <a
          href="mailto:support@listd.co.uk"
          className="text-primary hover:underline"
        >
          support@listd.co.uk
        </a>
        .
      </p>
    </main>
  )
}
