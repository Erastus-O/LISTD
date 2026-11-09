import { RoleLayoutShell } from '@/components/role/role-layout-shell'
import { requireRole } from '@/lib/dal'
import { countUnreadNotifications } from '@/lib/notifications'
import { AdminSidebarNav } from './_components/admin-sidebar-nav'

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // 'marketing' is a restricted seat: it may enter the admin shell but every
  // page except /admin/seo calls requireRole('admin') itself and 403s them.
  const session = await requireRole('admin', 'marketing')
  const marketingOnly =
    session.roles.includes('marketing') && !session.roles.includes('admin')
  const unreadCount = await countUnreadNotifications(session.userId)
  return (
    <RoleLayoutShell
      brand={marketingOnly ? 'LISTD Pro : Marketing' : 'LISTD Pro : Admin'}
      brandHref={marketingOnly ? '/admin/seo' : '/admin/dashboard'}
      nav={<AdminSidebarNav marketingOnly={marketingOnly} />}
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
