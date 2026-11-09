'use client'

import { useState } from 'react'
import {
  Briefcase,
  Copy,
  ExternalLink,
  Loader2,
  MapPin,
  Plus,
  Save,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { Vacancy } from '@/lib/careers'

const EMPLOYMENT_TYPES = [
  'Full-time',
  'Part-time',
  'Contract',
  'Freelance',
  'Internship',
]

/**
 * Vacancy manager: add/edit/enable/remove roles, save-all (same model as
 * the SEO editor — the API replaces the whole list). Apply links are the
 * Indeed / LinkedIn posting URLs the admin pastes per role.
 */
export function CareersManager({
  initialVacancies,
}: {
  initialVacancies: Vacancy[]
}) {
  const [vacancies, setVacancies] = useState<Vacancy[]>(initialVacancies)
  const [saving, setSaving] = useState(false)

  function update(id: string, patch: Partial<Vacancy>) {
    setVacancies((prev) =>
      prev.map((v) => (v.id === id ? { ...v, ...patch } : v))
    )
  }

  function addVacancy() {
    const v: Vacancy = {
      id: crypto.randomUUID(),
      title: '',
      location: '',
      employmentType: 'Full-time',
      description: '',
      enabled: true,
      createdAt: new Date().toISOString(),
    }
    setVacancies((prev) => [v, ...prev])
  }

  function remove(id: string) {
    setVacancies((prev) => prev.filter((v) => v.id !== id))
  }

  async function save() {
    if (saving) return
    for (const v of vacancies) {
      if (v.title.trim().length < 2) {
        toast.error('Every vacancy needs a title')
        return
      }
      for (const [label, url] of [
        ['Indeed', v.indeedUrl],
        ['LinkedIn', v.linkedinUrl],
      ] as const) {
        if (url && !/^https:\/\//i.test(url.trim())) {
          toast.error(`${label} link on "${v.title}" must start with https://`)
          return
        }
      }
    }
    setSaving(true)
    try {
      const res = await fetch('/api/admin/careers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vacancies: vacancies.map((v) => ({
            ...v,
            title: v.title.trim(),
            location: v.location.trim(),
            description: v.description.trim(),
            salary: v.salary?.trim() ?? '',
            indeedUrl: v.indeedUrl?.trim() ?? '',
            linkedinUrl: v.linkedinUrl?.trim() ?? '',
          })),
        }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`)
      // Server stamps slugs on first save — reflect them so the application
      // link appears without a refresh.
      if (Array.isArray(json?.vacancies)) {
        setVacancies(json.vacancies as Vacancy[])
      }
      toast.success('Vacancies saved', {
        description: 'The homepage and /careers are updated.',
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
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button
          type="button"
          size="sm"
          onClick={addVacancy}
          className="gap-1.5"
        >
          <Plus className="h-3.5 w-3.5" />
          Add vacancy
        </Button>
      </div>

      {vacancies.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center">
            <Briefcase className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" />
            <p className="text-sm font-medium text-foreground">
              No vacancies yet
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Add your first role — it goes live on the homepage and /careers
              as soon as you save.
            </p>
          </CardContent>
        </Card>
      ) : (
        vacancies.map((v) => (
          <Card key={v.id}>
            <CardContent className="space-y-4 p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Briefcase className="h-4 w-4 text-primary" />
                  <span className="text-sm font-semibold text-foreground">
                    {v.title || 'New vacancy'}
                  </span>
                  <Badge
                    variant={v.enabled ? 'default' : 'outline'}
                    className="text-[10px]"
                  >
                    {v.enabled ? 'Open — shown on site' : 'Hidden'}
                  </Badge>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => update(v.id, { enabled: !v.enabled })}
                    disabled={saving}
                    className="h-8 text-xs"
                  >
                    {v.enabled ? 'Hide' : 'Publish'}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => remove(v.id)}
                    disabled={saving}
                    className="h-8 gap-1 text-xs text-destructive hover:text-destructive"
                  >
                    <Trash2 className="h-3 w-3" />
                    Remove
                  </Button>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor={`title-${v.id}`}>Job title</Label>
                  <Input
                    id={`title-${v.id}`}
                    value={v.title}
                    maxLength={120}
                    onChange={(e) => update(v.id, { title: e.target.value })}
                    placeholder="e.g. Property Inspector — London"
                    disabled={saving}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`loc-${v.id}`}>Location</Label>
                  <div className="relative">
                    <MapPin className="absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id={`loc-${v.id}`}
                      value={v.location}
                      maxLength={120}
                      onChange={(e) =>
                        update(v.id, { location: e.target.value })
                      }
                      placeholder="e.g. London / Remote"
                      disabled={saving}
                      className="pl-8"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`type-${v.id}`}>Employment type</Label>
                  <select
                    id={`type-${v.id}`}
                    value={v.employmentType}
                    onChange={(e) =>
                      update(v.id, { employmentType: e.target.value })
                    }
                    disabled={saving}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    {EMPLOYMENT_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`sal-${v.id}`}>Salary (optional)</Label>
                  <Input
                    id={`sal-${v.id}`}
                    value={v.salary ?? ''}
                    maxLength={80}
                    onChange={(e) => update(v.id, { salary: e.target.value })}
                    placeholder="e.g. £28,000–£34,000"
                    disabled={saving}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor={`desc-${v.id}`}>Short description</Label>
                <Textarea
                  id={`desc-${v.id}`}
                  value={v.description}
                  maxLength={2000}
                  onChange={(e) =>
                    update(v.id, { description: e.target.value })
                  }
                  placeholder="What the role involves, who you're looking for…"
                  rows={3}
                  disabled={saving}
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor={`indeed-${v.id}`}>
                    Indeed posting link (optional)
                  </Label>
                  <Input
                    id={`indeed-${v.id}`}
                    value={v.indeedUrl ?? ''}
                    maxLength={500}
                    onChange={(e) =>
                      update(v.id, { indeedUrl: e.target.value })
                    }
                    placeholder="https://uk.indeed.com/job/…"
                    disabled={saving}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`li-${v.id}`}>
                    LinkedIn posting link (optional)
                  </Label>
                  <Input
                    id={`li-${v.id}`}
                    value={v.linkedinUrl ?? ''}
                    maxLength={500}
                    onChange={(e) =>
                      update(v.id, { linkedinUrl: e.target.value })
                    }
                    placeholder="https://www.linkedin.com/jobs/view/…"
                    disabled={saving}
                  />
                </div>
              </div>
              {v.slug ? (
                <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
                  <p className="text-xs font-medium text-foreground">
                    LISTD application link
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    Applicants complete the application on LISTD at this URL.
                    Paste it into Indeed or LinkedIn as the &ldquo;apply on
                    company website&rdquo; link.
                  </p>
                  <div className="mt-2 flex items-center gap-2">
                    <code className="min-w-0 flex-1 truncate rounded bg-background px-2.5 py-1.5 font-mono text-[11px] text-foreground">
                      https://www.listd.co.uk/careers/{v.slug}
                    </code>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 shrink-0 gap-1 text-xs"
                      onClick={() => {
                        navigator.clipboard
                          .writeText(`https://www.listd.co.uk/careers/${v.slug}`)
                          .then(() => toast.success('Application link copied'))
                          .catch(() => toast.error('Could not copy'))
                      }}
                    >
                      <Copy className="h-3 w-3" />
                      Copy
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <ExternalLink className="h-3 w-3" />
                  Save to generate this role&rsquo;s LISTD application link
                  (for pasting into Indeed / LinkedIn).
                </p>
              )}
            </CardContent>
          </Card>
        ))
      )}

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
