import Link from 'next/link'
import { inArray } from 'drizzle-orm'
import { Percent, Plug } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { AvatarUploader } from '@/components/role/avatar-uploader'
import { platformSettings, withServiceRole } from '@/db'
import { ConsentCard } from '@/components/legal/consent-card'
import { requireRole } from '@/lib/dal'
import { AdminSettingsForm } from './admin-settings-form'

export const metadata = { title: 'Admin · Settings' }

const TRUSTPILOT_KEYS = [
  'trustpilot_enabled',
  'trustpilot_embed_code',
  'trustpilot_review_link',
] as const

const SOCIAL_KEYS = [
  'instagram_url',
  'facebook_url',
  'linkedin_url',
  'tiktok_url',
  'x_url',
  'whatsapp_url',
] as const

const ALL_KEYS = [...TRUSTPILOT_KEYS, ...SOCIAL_KEYS] as const

export default async function AdminSettingsPage() {
  const session = await requireRole('admin')
  // Service-role read of platform_settings: this page is admin-only (gated by
  // requireRole('admin') in the parent layout), and the values are public-
  // facing anyway via the public-read RLS policy.
  const rows = await withServiceRole(async (tx) =>
    tx
      .select({
        key: platformSettings.key,
        value: platformSettings.value,
      })
      .from(platformSettings)
      .where(inArray(platformSettings.key, [...ALL_KEYS]))
  )

  const map = new Map(rows.map((r) => [r.key, r.value ?? '']))

  const initial = {
    trustpilot_enabled: map.get('trustpilot_enabled') === 'true',
    trustpilot_embed_code: map.get('trustpilot_embed_code') ?? '',
    trustpilot_review_link: map.get('trustpilot_review_link') ?? '',
    instagram_url: map.get('instagram_url') ?? '',
    facebook_url: map.get('facebook_url') ?? '',
    linkedin_url: map.get('linkedin_url') ?? '',
    tiktok_url: map.get('tiktok_url') ?? '',
    x_url: map.get('x_url') ?? '',
    whatsapp_url: map.get('whatsapp_url') ?? '',
  }

  return (
    <div className="w-full space-y-6 px-6 py-10">
      <div>
        <h1 className="font-display text-3xl text-foreground">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your admin profile and public-facing platform configuration.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Link
          href="/admin/settings/tax"
          className="group flex items-center gap-3 rounded-md border border-border bg-card p-4 transition-colors hover:bg-muted/40"
        >
          <Percent className="h-5 w-5 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium text-foreground">
              Tax &amp; invoicing
            </p>
            <p className="text-xs text-muted-foreground">
              Tax-rate library, company block on PDF, numbering preview.
            </p>
          </div>
        </Link>
        <Link
          href="/admin/settings/billing"
          className="group flex items-center gap-3 rounded-md border border-border bg-card p-4 transition-colors hover:bg-muted/40"
        >
          <Plug className="h-5 w-5 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium text-foreground">
              Billing provider
            </p>
            <p className="text-xs text-muted-foreground">
              Switch between the inbuilt generator and Xero (stub).
            </p>
          </div>
        </Link>
      </div>

      <Card>
        <CardContent className="space-y-3 p-6">
          <h2 className="text-base font-semibold">Profile photo</h2>
          <p className="text-xs text-muted-foreground">
            Visible to staff in the top bar and audit trail.
          </p>
          <AvatarUploader
            userId={session.userId}
            initialAvatarUrl={session.profile?.avatarUrl ?? null}
            displayName={session.profile?.fullName ?? null}
          />
        </CardContent>
      </Card>
      <AdminSettingsForm initial={initial} />

      {/* Legal & privacy consent */}
      <ConsentCard userId={session.userId} />
    </div>
  )
}
