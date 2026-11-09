'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ExternalLink, Loader2, Save } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

export type SeoRow = {
  path: string
  label: string
  defaultTitle: string
  defaultDescription: string
  /** Current override values ('' = no override, default in effect). */
  title: string
  description: string
  keywords: string
  jsonLd: string
}

const TITLE_MAX = 70
const DESC_MAX = 300
const KEYWORDS_MAX = 300
const JSONLD_MAX = 10000

/**
 * Editor grid for the marketing pages' meta. Overrides are stored server-side
 * as one blob; empty fields mean "use the code default" (shown as the
 * placeholder). Character counters mirror the API limits.
 */
export function SeoMetaForm({ initialRows }: { initialRows: SeoRow[] }) {
  const router = useRouter()
  const [rows, setRows] = useState(initialRows)
  const [saving, setSaving] = useState(false)

  function update(
    path: string,
    patch: Partial<Pick<SeoRow, 'title' | 'description' | 'keywords' | 'jsonLd'>>
  ) {
    setRows((prev) =>
      prev.map((r) => (r.path === path ? { ...r, ...patch } : r))
    )
  }

  async function save() {
    if (saving) return
    // Catch a malformed JSON-LD document before the round-trip, naming the
    // page — the API rejects it anyway, but this error is friendlier.
    for (const r of rows) {
      if (!r.jsonLd.trim()) continue
      try {
        const parsed = JSON.parse(r.jsonLd)
        if (typeof parsed !== 'object' || parsed === null) throw new Error()
      } catch {
        toast.error(`Invalid JSON-LD on ${r.label}`, {
          description: 'The schema must be valid JSON (an object or array).',
        })
        return
      }
    }
    setSaving(true)
    try {
      const res = await fetch('/api/admin/seo-meta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entries: rows.map((r) => ({
            path: r.path,
            title: r.title.trim(),
            description: r.description.trim(),
            keywords: r.keywords.trim(),
            jsonLd: r.jsonLd.trim(),
          })),
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error ?? `HTTP ${res.status}`)
      }
      toast.success('SEO meta saved', {
        description: 'Pages revalidated — changes are live.',
      })
      router.refresh()
    } catch (err) {
      toast.error('Could not save', {
        description: err instanceof Error ? err.message : 'Please try again.',
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      {rows.map((r) => {
        const overridden = !!(r.title || r.description || r.keywords || r.jsonLd)
        return (
          <Card key={r.path}>
            <CardContent className="space-y-3 p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold text-foreground">
                    {r.label}
                  </h2>
                  <a
                    href={`https://www.listd.co.uk${r.path === '/' ? '' : r.path}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 font-mono text-[11px] text-muted-foreground hover:text-primary"
                  >
                    {r.path}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                    overridden
                      ? 'bg-primary/10 text-primary'
                      : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {overridden ? 'Customised' : 'Using default'}
                </span>
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <Label htmlFor={`t-${r.path}`} className="text-xs">
                    Meta title
                  </Label>
                  <span className="text-[10px] text-muted-foreground">
                    {(r.title || r.defaultTitle).length}/{TITLE_MAX}
                  </span>
                </div>
                <Input
                  id={`t-${r.path}`}
                  value={r.title}
                  maxLength={TITLE_MAX}
                  onChange={(e) => update(r.path, { title: e.target.value })}
                  placeholder={r.defaultTitle}
                  disabled={saving}
                  className="mt-1 text-sm"
                />
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <Label htmlFor={`d-${r.path}`} className="text-xs">
                    Meta description
                  </Label>
                  <span className="text-[10px] text-muted-foreground">
                    {(r.description || r.defaultDescription).length}/{DESC_MAX}
                  </span>
                </div>
                <Textarea
                  id={`d-${r.path}`}
                  value={r.description}
                  maxLength={DESC_MAX}
                  onChange={(e) =>
                    update(r.path, { description: e.target.value })
                  }
                  placeholder={r.defaultDescription}
                  disabled={saving}
                  rows={2}
                  className="mt-1 text-sm"
                />
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <Label htmlFor={`k-${r.path}`} className="text-xs">
                    Keywords
                  </Label>
                  <span className="text-[10px] text-muted-foreground">
                    {r.keywords.length}/{KEYWORDS_MAX}
                  </span>
                </div>
                <Input
                  id={`k-${r.path}`}
                  value={r.keywords}
                  maxLength={KEYWORDS_MAX}
                  onChange={(e) => update(r.path, { keywords: e.target.value })}
                  placeholder="Comma-separated keywords"
                  disabled={saving}
                  className="mt-1 text-sm"
                />
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <Label htmlFor={`j-${r.path}`} className="text-xs">
                    JSON-LD Schema
                  </Label>
                  <span className="text-[10px] text-muted-foreground">
                    {r.jsonLd.length}/{JSONLD_MAX}
                  </span>
                </div>
                <Textarea
                  id={`j-${r.path}`}
                  value={r.jsonLd}
                  maxLength={JSONLD_MAX}
                  onChange={(e) => update(r.path, { jsonLd: e.target.value })}
                  placeholder='{"@context": "https://schema.org", ...}'
                  disabled={saving}
                  rows={4}
                  className="mt-1 font-mono text-xs"
                />
                <p className="mt-1 text-[10px] text-muted-foreground">
                  Rendered on the page as an application/ld+json script. Must
                  be valid JSON.
                </p>
              </div>

              {overridden && (
                <button
                  type="button"
                  onClick={() =>
                    update(r.path, {
                      title: '',
                      description: '',
                      keywords: '',
                      jsonLd: '',
                    })
                  }
                  disabled={saving}
                  className="text-xs text-muted-foreground underline-offset-2 hover:text-destructive hover:underline"
                >
                  Reset to default
                </button>
              )}
            </CardContent>
          </Card>
        )
      })}

      <div className="sticky bottom-4 flex justify-end">
        <Button onClick={save} disabled={saving} className="gap-1.5 shadow-lg">
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          Save all
        </Button>
      </div>
    </div>
  )
}
