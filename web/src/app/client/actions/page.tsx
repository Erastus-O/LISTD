import Link from 'next/link'
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  FileText,
  ScrollText,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { requireSession } from '@/lib/dal'
import { loadClientPendingActions } from '@/lib/dashboard/client-stats'
import { pendingActionHref } from '@/components/dashboard/client-cards'

export const metadata = { title: 'Pending actions' }
export const dynamic = 'force-dynamic'

const META = {
  draft: { icon: ScrollText, tone: 'text-warning' },
  awaiting_signoff: { icon: CheckCircle2, tone: 'text-success' },
  awaiting_ack: { icon: FileText, tone: 'text-primary' },
  pre_inspection_ack: { icon: AlertCircle, tone: 'text-destructive' },
} as const

/**
 * Full list of the client's pending actions — every flavour (drafts awaiting
 * payment, reports awaiting sign-off, and pre-inspection confirmations), not
 * just the top 5 shown on the dashboard card. Each row links to the surface
 * where the action can actually be completed.
 */
export default async function ClientActionsPage() {
  const session = await requireSession()
  const actions = await loadClientPendingActions(session.userId)

  return (
    <div className="w-full space-y-6 px-6 py-10">
      <div>
        <Link
          href="/client/dashboard"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to dashboard
        </Link>
        <h1 className="mt-3 font-display text-3xl text-foreground">
          Pending actions
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {actions.length === 0
            ? 'Nothing needs your attention right now.'
            : `${actions.length} ${actions.length === 1 ? 'item' : 'items'} needing your attention.`}
        </p>
      </div>

      {actions.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <CheckCircle2 className="h-6 w-6 text-success" />
            <p className="text-sm font-medium text-foreground">
              You&rsquo;re all caught up.
            </p>
            <p className="text-xs text-muted-foreground">
              No drafts, sign-offs, or confirmations waiting on you.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y divide-border">
              {actions.map((it) => {
                const m = META[it.reason]
                const Icon = m.icon
                return (
                  <li key={it.jobId}>
                    <Link
                      href={pendingActionHref(it)}
                      className="flex items-center gap-3 px-5 py-4 text-sm transition-colors hover:bg-muted/30"
                    >
                      <Icon className={`h-4 w-4 shrink-0 ${m.tone}`} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-foreground">
                          {it.label}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {it.address ?? 'No property linked'}
                          {it.scheduledDate && ` · ${formatDate(it.scheduledDate)}`}
                        </p>
                      </div>
                      <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                    </Link>
                  </li>
                )
              })}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: '2-digit',
  })
}
