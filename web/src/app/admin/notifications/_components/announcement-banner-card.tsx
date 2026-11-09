'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Megaphone, Save } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { AnnouncementBannerState } from '@/lib/dashboard/admin-notifications'

type Target = 'all' | 'clients' | 'clerks'

type Props = { initial: AnnouncementBannerState }

/**
 * Platform Announcement Banner editor (Lovable port —
 * `AnnouncementBannerSection`).
 *
 * Stores four `platform_settings` keys via
 * `/api/admin/notifications/banner`. Toggle gates whether the banner
 * renders for downstream consumers; expiry is a soft client-side check
 * downstream rather than a server cron.
 */
export function AnnouncementBannerCard({ initial }: Props) {
  const router = useRouter()
  const [enabled, setEnabled] = useState(initial.enabled)
  const [text, setText] = useState(initial.text)
  const [expiresAt, setExpiresAt] = useState(initial.expiresAt)
  const [target, setTarget] = useState<Target>(
    initial.target === 'clients' || initial.target === 'clerks'
      ? initial.target
      : 'all'
  )
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    if (saving) return
    setSaving(true)
    try {
      const res = await fetch('/api/admin/notifications/banner', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled,
          text: text.trim(),
          expiresAt: expiresAt.trim(),
          target,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error ?? `HTTP ${res.status}`)
      }
      toast.success('Banner settings saved')
      router.refresh()
    } catch (err) {
      toast.error('Could not save banner', {
        description: err instanceof Error ? err.message : 'Please try again.',
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardContent className="space-y-4 p-6">
        <div className="flex items-center gap-2">
          <Megaphone className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-base font-semibold">
            Platform announcement banner
          </h2>
        </div>

        <label className="flex items-center gap-3 text-sm">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            disabled={saving}
            className="h-4 w-4"
          />
          {enabled ? 'Banner active' : 'Banner disabled'}
        </label>

        <div>
          <Label className="text-xs">Banner text</Label>
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Important platform announcement…"
            disabled={saving}
            className="mt-1 h-9 text-sm"
          />
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <Label className="text-xs">Expires at</Label>
            <Input
              type="datetime-local"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              disabled={saving}
              className="mt-1 h-9 text-sm"
            />
          </div>
          <div>
            <Label className="text-xs">Target</Label>
            <Select
              value={target}
              onValueChange={(v) => setTarget(v as Target)}
              disabled={saving}
            >
              <SelectTrigger className="mt-1 h-9 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All users</SelectItem>
                <SelectItem value="clients">Clients only</SelectItem>
                <SelectItem value="clerks">Pros only</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {enabled && text.trim() && (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <strong>Preview:</strong> {text}
          </div>
        )}

        <div className="flex justify-end">
          <Button
            type="button"
            size="sm"
            onClick={handleSave}
            disabled={saving}
            className="gap-1.5"
          >
            {saving ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Save className="h-3 w-3" />
            )}
            Save banner settings
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
