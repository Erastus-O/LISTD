'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { ReportTemplateRow } from '@/lib/dashboard/admin-report-templates'

type Area = { name: string; items: { name: string }[] }

type Props =
  | { mode: 'create'; trigger?: React.ReactNode }
  | {
      mode: 'edit'
      template: ReportTemplateRow
      trigger?: React.ReactNode
    }
  | {
      mode: 'duplicate'
      template: ReportTemplateRow
      trigger?: React.ReactNode
    }

/**
 * Template create/edit/duplicate modal (Lovable port — `ReportTemplateManager`
 * `Dialog` block). Areas → items nested form; submit posts to
 * `/api/admin/report-templates`. The handler is upsert-shaped (id optional)
 * so create and update share one endpoint.
 *
 * Duplicate is a create with prefilled fields and `(Copy)` appended to the
 * name — matches Lovable's behaviour.
 */
export function TemplateEditorTrigger(props: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const initial = computeInitial(props)
  const [name, setName] = useState(initial.name)
  const [areas, setAreas] = useState<Area[]>(initial.areas)
  const [saving, setSaving] = useState(false)

  function reset() {
    setName(initial.name)
    setAreas(initial.areas)
  }

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (!next) reset()
  }

  async function handleSubmit() {
    if (saving) return
    if (!name.trim()) {
      toast.error('Name required')
      return
    }
    const editingId =
      props.mode === 'edit' ? props.template.id : undefined
    setSaving(true)
    try {
      const res = await fetch('/api/admin/report-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingId,
          name: name.trim(),
          structure: areas,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error ?? `HTTP ${res.status}`)
      }
      toast.success(
        props.mode === 'edit' ? 'Template updated' : 'Template created'
      )
      setOpen(false)
      reset()
      router.refresh()
    } catch (err) {
      toast.error('Could not save template', {
        description: err instanceof Error ? err.message : 'Please try again.',
      })
    } finally {
      setSaving(false)
    }
  }

  const trigger = props.trigger ?? (
    <Button type="button" size="sm" className="gap-1.5">
      <Plus className="h-4 w-4" />
      New template
    </Button>
  )

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {props.mode === 'edit' ? 'Edit template' : 'New template'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label className="text-xs">Template name</Label>
            <Input
              placeholder="e.g. Standard 2-Bed Unfurnished"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={saving}
              className="mt-1"
            />
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Areas & items</Label>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() =>
                  setAreas((prev) => [
                    ...prev,
                    { name: '', items: [{ name: '' }] },
                  ])
                }
                disabled={saving}
                className="h-7 gap-1 px-2 text-[11px]"
              >
                <Plus className="h-3 w-3" />
                Add area
              </Button>
            </div>

            {areas.map((area, areaIdx) => (
              <Card key={areaIdx} className="border-dashed">
                <CardContent className="space-y-3 p-4">
                  <div className="flex items-center gap-2">
                    <Input
                      placeholder="Area name (e.g. Kitchen)"
                      value={area.name}
                      onChange={(e) =>
                        setAreas((prev) => {
                          const next = [...prev]
                          next[areaIdx] = { ...next[areaIdx], name: e.target.value }
                          return next
                        })
                      }
                      disabled={saving}
                      className="font-medium"
                    />
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      onClick={() =>
                        setAreas((prev) =>
                          prev.length <= 1
                            ? prev
                            : prev.filter((_, i) => i !== areaIdx)
                        )
                      }
                      disabled={saving || areas.length <= 1}
                      className="shrink-0 text-muted-foreground hover:text-destructive"
                      aria-label="Remove area"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>

                  <div className="space-y-2 border-l-2 border-muted pl-4">
                    {area.items.map((item, itemIdx) => (
                      <div key={itemIdx} className="flex items-center gap-2">
                        <Input
                          placeholder="Item name (e.g. Oven, Sockets)"
                          value={item.name}
                          onChange={(e) =>
                            setAreas((prev) => {
                              const next = [...prev]
                              const items = [...next[areaIdx].items]
                              items[itemIdx] = { name: e.target.value }
                              next[areaIdx] = { ...next[areaIdx], items }
                              return next
                            })
                          }
                          disabled={saving}
                          className="h-8 text-sm"
                        />
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          onClick={() =>
                            setAreas((prev) => {
                              const next = [...prev]
                              if (next[areaIdx].items.length <= 1) return prev
                              next[areaIdx] = {
                                ...next[areaIdx],
                                items: next[areaIdx].items.filter(
                                  (_, i) => i !== itemIdx
                                ),
                              }
                              return next
                            })
                          }
                          disabled={saving || area.items.length <= 1}
                          className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                          aria-label="Remove item"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ))}
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setAreas((prev) => {
                          const next = [...prev]
                          next[areaIdx] = {
                            ...next[areaIdx],
                            items: [...next[areaIdx].items, { name: '' }],
                          }
                          return next
                        })
                      }
                      disabled={saving}
                      className="h-7 gap-1 px-2 text-[11px]"
                    >
                      <Plus className="h-3 w-3" />
                      Add item
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline" disabled={saving}>
              Cancel
            </Button>
          </DialogClose>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={saving}
            className="gap-1.5"
          >
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {props.mode === 'edit' ? 'Update' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function computeInitial(props: Props): { name: string; areas: Area[] } {
  if (props.mode === 'create') {
    return { name: '', areas: [{ name: '', items: [{ name: '' }] }] }
  }
  const t = props.template
  const nameInitial =
    props.mode === 'duplicate' ? `${t.name} (Copy)` : t.name
  const areasInitial: Area[] =
    t.structure.length === 0
      ? [{ name: '', items: [{ name: '' }] }]
      : t.structure.map((a) => ({
          name: a.name,
          items: a.items.length === 0 ? [{ name: '' }] : a.items.map((i) => ({ name: i.name })),
        }))
  return { name: nameInitial, areas: areasInitial }
}
