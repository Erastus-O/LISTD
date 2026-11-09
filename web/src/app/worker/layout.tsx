import { redirect } from 'next/navigation'
import { RoleLayoutShell } from '@/components/role/role-layout-shell'
import { requireRole } from '@/lib/dal'
import { loadCallerMembership } from '@/lib/dashboard/client-workers'
import { countUnreadNotifications } from '@/lib/notifications'
import { WorkerSidebarNav } from './_components/worker-sidebar-nav'

export default async function WorkerLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await requireRole('client', 'admin')
  const membership = await loadCallerMembership(session.userId)
  // Only org workers can use the /worker surface. Owners and admins are
  // bounced back to /client/dashboard — they have richer pages there.
  if (!session.roles.includes('admin')) {
    if (!membership || membership.orgRole !== 'worker') {
      redirect('/client/dashboard')
    }
  }
  const unreadCount = await countUnreadNotifications(session.userId)
  return (
    <RoleLayoutShell
      brand="LISTD Pro: Worker"
      brandHref="/worker/dashboard"
      nav={<WorkerSidebarNav />}
      userEmail={session.email}
      userName={session.profile?.fullName ?? null}
      userAvatarUrl={session.profile?.avatarUrl ?? null}
      unreadCount={unreadCount}
      notificationsHref={null}
    >
      {children}
    </RoleLayoutShell>
  )
}
