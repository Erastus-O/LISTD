'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

type Settings = {
  trustpilot_enabled: boolean
  trustpilot_embed_code: string
  trustpilot_review_link: string
  instagram_url: string
  facebook_url: string
  linkedin_url: string
  tiktok_url: string
  x_url: string
  whatsapp_url: string
}

const SOCIAL_FIELDS: Array<{
  key: keyof Settings
  label: string
  placeholder: string
}> = [
  { key: 'instagram_url', label: 'Instagram', placeholder: 'https://instagram.com/…' },
  { key: 'facebook_url', label: 'Facebook', placeholder: 'https://facebook.com/…' },
  { key: 'linkedin_url', label: 'LinkedIn', placeholder: 'https://linkedin.com/company/…' },
  { key: 'tiktok_url', label: 'TikTok', placeholder: 'https://tiktok.com/@…' },
  { key: 'x_url', label: 'X (Twitter)', placeholder: 'https://x.com/…' },
  { key: 'whatsapp_url', label: 'WhatsApp', placeholder: 'https://wa.me/44…' },
]

export function AdminSettingsForm({ initial }: { initial: Settings }) {
  const router = useRouter()
  const [form, setForm] = useState<Settings>(initial)
  const [saving, setSaving] = useState(false)

  function update<K extends keyof Settings>(key: K, value: Settings[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const res = await fetch('/api/admin/platform-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trustpilot_enabled: String(form.trustpilot_enabled),
          trustpilot_embed_code: form.trustpilot_embed_code,
          trustpilot_review_link: form.trustpilot_review_link,
          instagram_url: form.instagram_url,
          facebook_url: form.facebook_url,
          linkedin_url: form.linkedin_url,
          tiktok_url: form.tiktok_url,
          x_url: form.x_url,
          whatsapp_url: form.whatsapp_url,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error ?? `HTTP ${res.status}`)
      }
      toast.success('Settings saved', {
        description: 'Public pages will pick up the change on next visit.',
      })
      router.refresh()
    } catch (err) {
      toast.error('Failed to save', {
        description: err instanceof Error ? err.message : 'Unknown error',
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-10">
      <section className="rounded-xl border border-border bg-card p-6">
        <header className="mb-6">
          <h2 className="text-lg font-semibold text-foreground">Trustpilot</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Controls the Trustpilot section on the landing page. The embed code
            is a snippet pasted from your Trustpilot Business dashboard.
          </p>
        </header>

        <div className="space-y-5">
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={form.trustpilot_enabled}
              onChange={(e) => update('trustpilot_enabled', e.target.checked)}
              className="mt-1 h-4 w-4 rounded border-border accent-primary"
            />
            <span>
              <span className="block text-sm font-medium text-foreground">
                Show Trustpilot section
              </span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                When off, the section is hidden regardless of embed code.
              </span>
            </span>
          </label>

          <div>
            <Label htmlFor="trustpilot_embed_code" className="text-xs font-medium">
              Embed code
            </Label>
            <Textarea
              id="trustpilot_embed_code"
              value={form.trustpilot_embed_code}
              onChange={(e) => update('trustpilot_embed_code', e.target.value)}
              placeholder='<div class="trustpilot-widget" data-locale="en-GB" …></div>'
              className="mt-1.5 min-h-[140px] font-mono text-xs"
              spellCheck={false}
            />
            <p className="mt-1.5 text-xs text-muted-foreground">
              Paste the full <code>&lt;div class=&quot;trustpilot-widget&quot;&gt;</code>{' '}
              snippet from Trustpilot. The bootstrap script is loaded
              automatically.
            </p>
          </div>

          <div>
            <Label htmlFor="trustpilot_review_link" className="text-xs font-medium">
              Leave-a-review link
            </Label>
            <Input
              id="trustpilot_review_link"
              type="url"
              value={form.trustpilot_review_link}
              onChange={(e) => update('trustpilot_review_link', e.target.value)}
              placeholder="https://www.trustpilot.com/evaluate/listd.co.uk"
              className="mt-1.5"
            />
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-6">
        <header className="mb-6">
          <h2 className="text-lg font-semibold text-foreground">Social links</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Shown in the public footer. Leave a field blank to hide that icon.
          </p>
        </header>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          {SOCIAL_FIELDS.map((f) => (
            <div key={f.key}>
              <Label htmlFor={f.key} className="text-xs font-medium">
                {f.label}
              </Label>
              <Input
                id={f.key}
                type="url"
                value={form[f.key] as string}
                onChange={(e) => update(f.key, e.target.value as never)}
                placeholder={f.placeholder}
                className="mt-1.5"
              />
            </div>
          ))}
        </div>
      </section>

      <div className="flex justify-end">
        <Button type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Save changes'}
        </Button>
      </div>
    </form>
  )
}
