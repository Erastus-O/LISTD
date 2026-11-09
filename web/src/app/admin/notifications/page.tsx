import { Bell } from 'lucide-react'
import { requireRole } from '@/lib/dal'
import {
  groupAutomationSettings,
  loadAnnouncementBanner,
  loadAutomationSettings,
} from '@/lib/dashboard/admin-notifications'
import { AnnouncementBannerCard } from './_components/announcement-banner-card'
import { AutomationSettingsCard } from './_components/automation-settings-card'
import { SendNotificationCard } from './_components/send-notification-card'

export const metadata = { title: 'Admin · Notifications' }
export const dynamic = 'force-dynamic'

/**
 * Admin Notifications (Lovable port of `AdminNotifications.tsx`).
 *
 * Three sections, server-loaded:
 *   - Send Manual Notification — broadcast surface. Typed-confirm required
 *     beyond 50 recipients. Each send writes a
 *     `platform_setting/notification.broadcast` audit row.
 *   - Platform Announcement Banner — stores 4 keys in `platform_settings`.
 *   - Automation Settings — per-row editable numeric value backed by
 *     `notification_automation_settings`.
 */
export default async function AdminNotificationsPage() {
  await requireRole('admin')
  const [banner, automation] = await Promise.all([
    loadAnnouncementBanner(),
    loadAutomationSettings(),
  ])
  const grouped = groupAutomationSettings(automation)

  return (
    <div className="w-full space-y-6 px-6 py-10">
      <div className="flex items-center gap-2">
        <Bell className="h-6 w-6 text-muted-foreground" />
        <h1 className="font-display text-3xl text-foreground">
          Notification Centre
        </h1>
      </div>

      <SendNotificationCard />
      <AnnouncementBannerCard initial={banner} />
      <AutomationSettingsCard grouped={grouped} />
    </div>
  )
}
