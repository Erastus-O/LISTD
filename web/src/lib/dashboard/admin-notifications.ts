import 'server-only'
import { asc, eq, inArray } from 'drizzle-orm'
import {
  db,
  notificationAutomationSettings,
  platformSettings,
} from '@/db'
import { bust, cacheKey, getOrSet } from '@/lib/cache'

// Reference-data TTLs — these tables change minutes-to-weeks apart, not
// seconds. 5 minutes is the sweet spot: stale window short enough that
// admins don't trip over their own toggles, long enough to cache 99% of
// repeat reads during a typical admin session.
const REF_DATA_TTL_SECONDS = 5 * 60

const ANNOUNCEMENT_BANNER_KEY = cacheKey('admin', 'announcement-banner')
const AUTOMATION_SETTINGS_KEY = cacheKey('admin', 'automation-settings')

/**
 * Server-only data layer for the admin Notifications page (Lovable port of
 * `AdminNotifications.tsx`). Three surfaces:
 *
 *   1. Announcement banner state (4 `platform_settings` keys)
 *   2. Automation settings rows (`notification_automation_settings`)
 *   3. Send-manual broadcasts — no preload (form-driven)
 */

const BANNER_KEYS = [
  'announcement_enabled',
  'announcement_text',
  'announcement_expires',
  'announcement_target',
] as const

export type AnnouncementBannerState = {
  enabled: boolean
  text: string
  expiresAt: string
  /** `'all' | 'clients' | 'clerks'` — leaving as string so adding a new
   *  target later doesn't break the loader. */
  target: string
}

export async function loadAnnouncementBanner(): Promise<AnnouncementBannerState> {
  return getOrSet(ANNOUNCEMENT_BANNER_KEY, REF_DATA_TTL_SECONDS, async () => {
    const rows = await db
      .select({
        key: platformSettings.key,
        value: platformSettings.value,
      })
      .from(platformSettings)
      .where(inArray(platformSettings.key, [...BANNER_KEYS]))
    const map = new Map(rows.map((r) => [r.key, r.value ?? '']))
    return {
      enabled: map.get('announcement_enabled') === 'true',
      text: map.get('announcement_text') ?? '',
      expiresAt: map.get('announcement_expires') ?? '',
      target: map.get('announcement_target') || 'all',
    }
  })
}

/**
 * Bust the announcement-banner cache. Call after any write to the
 * announcement_* platform_settings keys so the next admin view shows the
 * fresh value instead of waiting out the TTL.
 */
export async function bustAnnouncementBanner(): Promise<void> {
  return bust(ANNOUNCEMENT_BANNER_KEY)
}

export type AutomationSettingRow = {
  id: string
  settingKey: string
  label: string
  category: string
  value: string
  updatedAt: string
}

export async function loadAutomationSettings(): Promise<AutomationSettingRow[]> {
  return getOrSet(AUTOMATION_SETTINGS_KEY, REF_DATA_TTL_SECONDS, async () =>
    db
      .select({
        id: notificationAutomationSettings.id,
        settingKey: notificationAutomationSettings.settingKey,
        label: notificationAutomationSettings.label,
        category: notificationAutomationSettings.category,
        value: notificationAutomationSettings.value,
        updatedAt: notificationAutomationSettings.updatedAt,
      })
      .from(notificationAutomationSettings)
      .orderBy(
        asc(notificationAutomationSettings.category),
        asc(notificationAutomationSettings.settingKey)
      )
  )
}

/**
 * Bust the automation-settings cache. Call after admin updates an
 * automation toggle so the next page render reflects it immediately.
 */
export async function bustAutomationSettings(): Promise<void> {
  return bust(AUTOMATION_SETTINGS_KEY)
}

/** UX labels for the automation category column. */
export const AUTOMATION_CATEGORY_LABELS: Record<string, string> = {
  job_recycling: 'Job Recycling',
  upsell: 'Upsell Reminders',
  invoice: 'Invoice Chasing',
  clerk: 'Clerk Alerts',
  quality: 'Quality Review',
  general: 'General',
}

/** Keys the banner-save route is allowed to touch. */
export const ANNOUNCEMENT_KEYS = BANNER_KEYS

/**
 * Lookup of automation-settings categories for the UI tabs/badges in
 * grouping order.
 */
export function groupAutomationSettings(
  rows: AutomationSettingRow[]
): Array<{ category: string; label: string; items: AutomationSettingRow[] }> {
  const grouped = new Map<string, AutomationSettingRow[]>()
  for (const r of rows) {
    const cat = r.category || 'general'
    const list = grouped.get(cat) ?? []
    list.push(r)
    grouped.set(cat, list)
  }
  return Array.from(grouped.entries()).map(([category, items]) => ({
    category,
    label: AUTOMATION_CATEGORY_LABELS[category] ?? category,
    items,
  }))
}

/**
 * Resolve a broadcast target string to the list of recipient user IDs. Used
 * by the `/api/admin/notifications/broadcast` handler — moved here so the
 * page can also surface "this would reach N users" preview counts later.
 *
 * Imports stay light — actual usage is in route handlers, but keeping the
 * helper next to the related loaders keeps the notification surface
 * cohesive.
 */
export type BroadcastTarget =
  | 'all_clients'
  | 'all_clerks'
  | 'all_users'
  | { kind: 'individual'; userId: string }

export async function resolveBroadcastRecipients(
  target: BroadcastTarget
): Promise<string[]> {
  if (typeof target === 'object') return [target.userId]
  const { profiles, userRoles } = await import('@/db')
  if (target === 'all_users') {
    const rows = await db
      .select({ userId: profiles.userId })
      .from(profiles)
      .where(eq(profiles.accountStatus, 'active'))
    return Array.from(new Set(rows.map((r) => r.userId)))
  }
  const role = target === 'all_clients' ? 'client' : 'clerk'
  const rows = await db
    .select({ userId: userRoles.userId })
    .from(userRoles)
    .where(eq(userRoles.role, role))
  return Array.from(new Set(rows.map((r) => r.userId)))
}
