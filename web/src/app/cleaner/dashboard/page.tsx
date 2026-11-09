import Link from 'next/link'
import { AlertCircle, Briefcase, CheckCircle2, Clock, Search } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { requireRole } from '@/lib/dal'
import { loadWorkerMonthEndDue } from '@/lib/billing/promo-debt'
import { MonthEndPayCard } from '@/components/billing/month-end-pay-card'

export const metadata = { title: 'Cleaner · Dashboard' }
export const dynamic = 'force-dynamic'

const VERIFICATION_BANNER: Record<
  string,
  { tone: 'warn' | 'info' | 'ok'; title: string; body: string; cta?: { href: string; label: string } }
> = {
  unverified: {
    tone: 'warn',
    title: 'Complete your verification',
    body: 'Finish your cleaner verification (ID, DBS and insurance) before cleaning jobs in your area appear.',
    cta: { href: '/onboarding/cleaner', label: 'Start verification' },
  },
  pending_verification: {
    tone: 'info',
    title: 'Your application is under review',
    body: "We typically review within 24 hours. You'll get an email and an in-app notification as soon as there's a decision.",
  },
  rejected: {
    tone: 'warn',
    title: 'A few changes are needed',
    body: 'Your submission was returned with changes requested. Update the affected documents and resubmit.',
    cta: { href: '/onboarding/cleaner', label: 'Update application' },
  },
  suspended: {
    tone: 'warn',
    title: 'Marketplace access suspended',
    body: 'A document on file has expired. Re-upload an in-date copy to restore access.',
    cta: { href: '/onboarding/cleaner', label: 'Re-upload documents' },
  },
}

export default async function CleanerDashboardPage() {
  const session = await requireRole('cleaner', 'admin')
  const status = session.profile?.verificationStatus ?? 'unverified'
  const banner = status !== 'verified' ? VERIFICATION_BANNER[status] : null
  const firstName = session.profile?.fullName?.split(' ')[0] ?? null
  const monthEndDue = await loadWorkerMonthEndDue(session.userId)

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-6 py-10">
      <div>
        <h1 className="font-display text-3xl text-foreground">
          {firstName ? `Welcome, ${firstName}` : 'Cleaner dashboard'}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your cleaning jobs, earnings and account.
        </p>
      </div>

      {banner && (
        <Card
          className={
            banner.tone === 'warn'
              ? 'border-amber-500/30 bg-amber-500/5'
              : 'border-primary/30 bg-primary/5'
          }
        >
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-5">
            <div className="flex items-start gap-3">
              {banner.tone === 'info' ? (
                <Clock className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
              ) : (
                <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
              )}
              <div>
                <p className="text-sm font-medium text-foreground">
                  {banner.title}
                </p>
                <p className="text-xs text-muted-foreground">{banner.body}</p>
              </div>
            </div>
            {banner.cta && (
              <Link
                href={banner.cta.href}
                className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
              >
                {banner.cta.label}
              </Link>
            )}
          </CardContent>
        </Card>
      )}

      <MonthEndPayCard due={monthEndDue} />

      {status === 'verified' && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="flex items-center gap-3 p-5">
            <CheckCircle2 className="h-5 w-5 shrink-0 text-primary" />
            <div>
              <p className="text-sm font-medium text-foreground">
                You&rsquo;re verified
              </p>
              <p className="text-xs text-muted-foreground">
                Cleaning jobs in your coverage area will appear here.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {status === 'verified' && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Link href="/cleaner/jobs/available">
            <Card className="h-full transition-colors hover:border-primary/50">
              <CardContent className="flex items-start gap-3 p-5">
                <Search className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                <div>
                  <p className="text-sm font-medium text-foreground">
                    Browse available cleans
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Find and accept Light, General and Deep cleans in your area.
                  </p>
                </div>
              </CardContent>
            </Card>
          </Link>
          <Link href="/cleaner/jobs">
            <Card className="h-full transition-colors hover:border-primary/50">
              <CardContent className="flex items-start gap-3 p-5">
                <Briefcase className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                <div>
                  <p className="text-sm font-medium text-foreground">My jobs</p>
                  <p className="text-xs text-muted-foreground">
                    Track accepted cleans and complete them on site.
                  </p>
                </div>
              </CardContent>
            </Card>
          </Link>
        </div>
      )}
    </div>
  )
}
