import { redirect } from 'next/navigation'
import { RoleLayoutShell } from '@/components/role/role-layout-shell'
import { requireSession } from '@/lib/dal'
import { loadCallerMembership } from '@/lib/dashboard/client-workers'
import { countUnreadNotifications } from '@/lib/notifications'
import { AdminSidebarNav } from '../admin/_components/admin-sidebar-nav'
import { ClerkSidebarNav } from '../clerk/_components/clerk-sidebar-nav'
import { ClientSidebarNav } from '../client/_components/client-sidebar-nav'
import { WorkerSidebarNav } from '../worker/_components/worker-sidebar-nav'

/**
 * Shared layout for the /help routes. Every other authenticated surface
 * sits inside a role-specific layout (admin / clerk / client / worker)
 * that owns the navbar; /help lived at the root and so rendered without
 * chrome. We mirror the appropriate `RoleLayoutShell` here based on the
 * caller's role so navigating to /help keeps the sidebar the user came
 * from. Role precedence: admin > clerk > client (worker when the caller
 * is a worker-org_role client).
 */
export default async function HelpLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await requireSession()
  const unreadCount = await countUnreadNotifications(session.userId)

  let nav: React.ReactNode
  let brand: string
  let brandHref: string

  if (session.roles.includes('admin')) {
    nav = <AdminSidebarNav />
    brand = 'LISTD Pro: Admin'
    brandHref = '/admin/dashboard'
  } else if (session.roles.includes('clerk')) {
    nav = <ClerkSidebarNav />
    brand = 'LISTD Pro: Clerk'
    brandHref = '/clerk/dashboard'
  } else if (session.roles.includes('client')) {
    const membership = await loadCallerMembership(session.userId)
    if (membership?.orgRole === 'worker') {
      nav = <WorkerSidebarNav />
      brand = 'LISTD Pro: Worker'
      brandHref = '/worker/dashboard'
    } else {
      nav = <ClientSidebarNav />
      brand = 'LISTD Pro: Client'
      brandHref = '/client/dashboard'
    }
  } else {
    // Authenticated but with no role we recognise — punt to root which
    // will route them sensibly (or back to /login if the session is
    // somehow torn).
    redirect('/')
  }

  return (
    <RoleLayoutShell
      brand={brand}
      brandHref={brandHref}
      nav={nav}
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
