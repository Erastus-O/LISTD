import { RoleLayoutShell } from '@/components/role/role-layout-shell'
import { requireRole } from '@/lib/dal'
import { countUnreadNotifications } from '@/lib/notifications'
import { SupportChat } from '@/components/assistant/support-chat'
import { ProSidebarNav } from '@/components/role/pro-sidebar-nav'
import { proServicesOf } from '@/lib/listd/pro-services'

export default async function ClerkLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Admin can view clerk pages for QA/impersonation — matches Lovable's
  // RoleGuard behaviour.
  const session = await requireRole('clerk', 'trades', 'admin')
  const unreadCount = await countUnreadNotifications(session.userId)
  return (
    <RoleLayoutShell
      brand="LISTD Pro"
      brandHref="/clerk/dashboard"
      nav={<ProSidebarNav services={proServicesOf(session.roles)} />}
      userEmail={session.email}
      userName={session.profile?.fullName ?? null}
      userAvatarUrl={session.profile?.avatarUrl ?? null}
      unreadCount={unreadCount}
      notificationsHref={null}
    >
      {children}
      {(session.roles.includes('clerk') || session.roles.includes('trades')) && (
        <SupportChat
          greeting="Hi! I’m LISTD Helper. Ask me about verification, finding and doing jobs, AI assist, or getting paid."
          suggestions={[
            'How do I get verified?',
            'How does AI assist work?',
            'How do I submit a report?',
          ]}
        />
      )}
    </RoleLayoutShell>
  )
}
