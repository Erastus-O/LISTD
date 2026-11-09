import { RoleLayoutShell } from '@/components/role/role-layout-shell'
import { requireRole } from '@/lib/dal'
import { countUnreadNotifications } from '@/lib/notifications'
import { SupportChat } from '@/components/assistant/support-chat'
import { CleanerSidebarNav } from './_components/cleaner-sidebar-nav'

export default async function CleanerLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Admin can view cleaner pages for QA/impersonation, mirroring the clerk shell.
  const session = await requireRole('cleaner', 'admin')
  const unreadCount = await countUnreadNotifications(session.userId)
  return (
    <RoleLayoutShell
      brand="LISTD Pro: Cleaner"
      brandHref="/cleaner/dashboard"
      nav={<CleanerSidebarNav />}
      userEmail={session.email}
      userName={session.profile?.fullName ?? null}
      userAvatarUrl={session.profile?.avatarUrl ?? null}
      unreadCount={unreadCount}
      notificationsHref={null}
    >
      {children}
      {session.roles.includes('cleaner') && (
        <SupportChat
          greeting="Hi! I’m LISTD Helper. Ask me about verification, accepting cleans, the completion checklist, or getting paid."
          suggestions={[
            'How do I get verified?',
            'How do I complete a clean?',
            'When do I get paid?',
          ]}
        />
      )}
    </RoleLayoutShell>
  )
}
