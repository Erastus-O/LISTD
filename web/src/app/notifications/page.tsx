import { PlaceholderPage } from '@/components/placeholder-page'
import { requireSession } from '@/lib/dal'

export const metadata = { title: 'Notifications' }

/**
 * Authenticated user notifications page. Any role.
 */
export default async function NotificationsPage() {
  await requireSession()
  return (
    <PlaceholderPage
      title="Notifications"
      port="src/pages/NotificationsPage.tsx"
    />
  )
}
