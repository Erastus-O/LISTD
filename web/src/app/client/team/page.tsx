import { Users } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { requireRole } from '@/lib/dal'
import {
  loadCallerMembership,
  loadOrgWorkers,
} from '@/lib/dashboard/client-workers'
import { InviteWorkerButton } from './_components/invite-worker-button'
import { WorkersGrid } from './_components/workers-grid'

export const metadata = { title: 'Client · Team' }
export const dynamic = 'force-dynamic'

/**
 * Client Team page. Lets the org owner invite + manage workers who can
 * post jobs on behalf of the organisation. Workers see a different surface
 * at `/worker/*`.
 *
 * Gating:
 *   - Caller must be an org owner. Non-owner clients (or solo clients
 *     without an organisation) see a friendly explanation card instead of
 *     the management UI.
 */
export default async function ClientTeamPage() {
  const session = await requireRole('client', 'admin')
  const membership = await loadCallerMembership(session.userId)
  const workers =
    membership && (membership.orgRole === 'owner' || session.roles.includes('admin'))
      ? await loadOrgWorkers(membership.organisationId, session.userId)
      : []

  const canManage =
    (!!membership && membership.orgRole === 'owner') ||
    session.roles.includes('admin')

  return (
    <div className="w-full space-y-6 px-6 py-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Users className="h-6 w-6 text-muted-foreground" />
          <div>
            <h1 className="font-display text-3xl text-foreground">Team</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Manage workers who can post jobs for your organisation.
            </p>
          </div>
        </div>
        {canManage && <InviteWorkerButton />}
      </div>

      {!membership ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            You don&apos;t belong to an organisation yet. Workers are linked
            to an organisation: set one up from your client settings to start
            inviting them.
          </CardContent>
        </Card>
      ) : !canManage ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            Only the organisation owner can manage workers. Reach out to your
            owner to add or remove team members.
          </CardContent>
        </Card>
      ) : workers.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No workers yet. Invite your first one: they&apos;ll get a login
            link by email.
          </CardContent>
        </Card>
      ) : (
        <WorkersGrid workers={workers} />
      )}
    </div>
  )
}
