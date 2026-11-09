import { RoleLayoutShell } from '@/components/role/role-layout-shell'
import { requireRole } from '@/lib/dal'
import { countUnreadNotifications } from '@/lib/notifications'
import { SupportChat } from '@/components/assistant/support-chat'
import { ClientSidebarNav } from './_components/client-sidebar-nav'

export default async function ClientLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Admin can view client pages too — matches Lovable's RoleGuard behaviour.
  const session = await requireRole('client', 'admin')
  const unreadCount = await countUnreadNotifications(session.userId)
  return (
    <RoleLayoutShell
      brand="LISTD Pro: Client"
      brandHref="/client/dashboard"
      nav={<ClientSidebarNav />}
      userEmail={session.email}
      userName={session.profile?.fullName ?? null}
      userAvatarUrl={session.profile?.avatarUrl ?? null}
      unreadCount={unreadCount}
      notificationsHref={null}
    >
      {children}
      {session.roles.includes('client') && (
        <SupportChat
          greeting="Hi! I’m LISTD Helper. Ask me anything about booking inspections or cleans, pricing, reports or your account."
          suggestions={[
            'How do I book an inspection?',
            'What’s included in a Deep clean?',
            'How is my price calculated?',
          ]}
        />
      )}
    </RoleLayoutShell>
  )
}
