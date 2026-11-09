import { eq } from 'drizzle-orm'
import { Bell } from 'lucide-react'
import { notificationPreferences, withServiceRole } from '@/db'
import { requireSession } from '@/lib/dal'
import { EnableDesktopNotifications } from '@/components/notifications/enable-desktop-notifications'
import { NotificationPreferencesForm } from './notification-preferences-form'

export const metadata = { title: 'Notification preferences' }

const DEFAULTS = {
  emailJobUpdates: true,
  emailPaymentUpdates: true,
  emailReportDelivery: true,
  emailNewMessages: true,
  emailMarketing: false,
  inappJobUpdates: true,
  inappPaymentUpdates: true,
  inappReportDelivery: true,
  inappNewMessages: true,
  smsJobUpdates: false,
  smsPaymentUpdates: false,
  whatsappOptIn: false,
  emailMidtermReminder: true,
  emailCheckoutReminder: true,
  emailNextServicePrompt: true,
} as const

/**
 * Notification preferences (M1 #16). Available to any signed-in user — both
 * clients and clerks share the same toggle surface, just see different
 * defaults applied via `notification_preferences` table inserts at signup.
 */
export default async function NotificationPreferencesPage() {
  const session = await requireSession()

  const [row] = await withServiceRole(async (tx) =>
    tx
      .select()
      .from(notificationPreferences)
      .where(eq(notificationPreferences.userId, session.userId))
      .limit(1)
  )

  const initial = row
    ? {
        emailJobUpdates: row.emailJobUpdates,
        emailPaymentUpdates: row.emailPaymentUpdates,
        emailReportDelivery: row.emailReportDelivery,
        emailNewMessages: row.emailNewMessages,
        emailMarketing: row.emailMarketing,
        inappJobUpdates: row.inappJobUpdates,
        inappPaymentUpdates: row.inappPaymentUpdates,
        inappReportDelivery: row.inappReportDelivery,
        inappNewMessages: row.inappNewMessages,
        smsJobUpdates: row.smsJobUpdates,
        smsPaymentUpdates: row.smsPaymentUpdates,
        whatsappOptIn: row.whatsappOptIn,
        emailMidtermReminder: row.emailMidtermReminder,
        emailCheckoutReminder: row.emailCheckoutReminder,
        emailNextServicePrompt: row.emailNextServicePrompt,
      }
    : { ...DEFAULTS }

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <div className="mb-8 flex items-start gap-4">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary">
          <Bell className="h-6 w-6" aria-hidden />
        </span>
        <div>
          <h1 className="font-display text-3xl text-foreground sm:text-4xl">
            Notification preferences
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Choose which channels we use to reach you. Changes save
            immediately.
          </p>
        </div>
      </div>
      <div className="mb-6">
        <EnableDesktopNotifications />
      </div>
      <NotificationPreferencesForm initial={initial} />
    </div>
  )
}
