'use client'

import { useState } from 'react'
import { AlertTriangle, Code2, Loader2, Save } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

const MAX = 20000

/**
 * Site-wide tracking-code editor. Paste a GTM / GA4 / Hotjar-style snippet
 * and it runs on every PUBLIC page (the pages in sitemap.xml) — never on
 * the logged-in app.
 */
export function SiteScriptsForm({
  initialHead,
  initialBodyEnd,
}: {
  initialHead: string
  initialBodyEnd: string
}) {
  const [head, setHead] = useState(initialHead)
  const [bodyEnd, setBodyEnd] = useState(initialBodyEnd)
  const [saving, setSaving] = useState(false)

  const dirty = head !== initialHead || bodyEnd !== initialBodyEnd

  async function save() {
    if (saving) return
    setSaving(true)
    try {
      const res = await fetch('/api/admin/site-scripts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ head, bodyEnd }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`)
      toast.success('Tracking code saved', {
        description: 'Live on all public pages within seconds.',
      })
    } catch (err) {
      toast.error('Could not save', {
        description: err instanceof Error ? err.message : 'Please try again.',
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div className="flex items-start gap-2">
          <Code2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <div>
            <h2 className="text-sm font-semibold text-foreground">
              Site-wide tracking code
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Paste analytics or marketing snippets (Google Tag Manager,
              GA4, Hotjar, Ahrefs, verification tags…). They run on{' '}
              <strong>every public page</strong> — the pages listed in
              sitemap.xml — on each page load, and are rendered into the
              page&rsquo;s server HTML, so meta and verification tags appear
              in <strong>view-source</strong> inside &lt;head&gt;. They never
              run inside the logged-in app, where account and payment data
              lives.
            </p>
          </div>
        </div>

        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
          <p className="text-xs text-muted-foreground">
            This code executes on the live public site. Only paste snippets
            from a source you trust, exactly as the provider supplied them.
            Every save is recorded in the activity log.
          </p>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="scripts-head" className="text-xs">
              Head — rendered into &lt;head&gt; (meta / verification tags,
              GTM, GA4)
            </Label>
            <span className="text-[10px] text-muted-foreground">
              {head.length}/{MAX}
            </span>
          </div>
          <Textarea
            id="scripts-head"
            value={head}
            maxLength={MAX}
            onChange={(e) => setHead(e.target.value)}
            placeholder={'<!-- Google Tag Manager -->\n<script>…</script>'}
            rows={8}
            disabled={saving}
            className="font-mono text-xs"
          />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="scripts-body" className="text-xs">
              End of body — optional (noscript fallbacks, chat widgets)
            </Label>
            <span className="text-[10px] text-muted-foreground">
              {bodyEnd.length}/{MAX}
            </span>
          </div>
          <Textarea
            id="scripts-body"
            value={bodyEnd}
            maxLength={MAX}
            onChange={(e) => setBodyEnd(e.target.value)}
            placeholder={'<noscript><iframe src="…"></iframe></noscript>'}
            rows={5}
            disabled={saving}
            className="font-mono text-xs"
          />
        </div>

        <div className="flex items-center justify-between">
          <p className="text-[11px] text-muted-foreground">
            {dirty ? 'Unsaved changes' : 'Saved'}
          </p>
          <Button onClick={save} disabled={saving} className="gap-1.5">
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Save tracking code
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
