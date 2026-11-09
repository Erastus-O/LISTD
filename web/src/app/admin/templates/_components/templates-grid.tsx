'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Copy,
  GripVertical,
  Loader2,
  Pencil,
  ToggleLeft,
  ToggleRight,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { ReportTemplateRow } from '@/lib/dashboard/admin-report-templates'
import { TemplateEditorTrigger } from './template-editor'

type Props = { templates: ReportTemplateRow[] }

/**
 * Card grid of report templates with per-row actions (edit / duplicate /
 * toggle active / delete). Edit and duplicate reuse the same
 * `TemplateEditorTrigger` modal in different `mode`s. Toggle + delete hit
 * dedicated endpoints with their own audit rows.
 */
export function TemplatesGrid({ templates }: Props) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {templates.map((t) => (
        <TemplateCard key={t.id} template={t} />
      ))}
    </div>
  )
}

function TemplateCard({ template }: { template: ReportTemplateRow }) {
  return (
    <Card className="relative">
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-semibold text-foreground">
            {template.name}
          </p>
          <Badge variant={template.isActive ? 'default' : 'secondary'}>
            {template.isActive ? 'Active' : 'Inactive'}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          {template.structure.length} area
          {template.structure.length === 1 ? '' : 's'} ·{' '}
          {template.itemCount} item{template.itemCount === 1 ? '' : 's'}
        </p>
        {template.structure.length > 0 && (
          <ul className="max-h-28 space-y-0.5 overflow-auto text-[11px] text-muted-foreground">
            {template.structure.map((a, i) => (
              <li key={i} className="flex items-center gap-1">
                <GripVertical className="h-3 w-3 shrink-0" />
                <span className="font-medium text-foreground">{a.name}</span>
                <span>({a.items.length})</span>
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-center gap-1 border-t border-border pt-2">
          <TemplateEditorTrigger
            mode="edit"
            template={template}
            trigger={
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-8 w-8"
                aria-label="Edit"
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            }
          />
          <TemplateEditorTrigger
            mode="duplicate"
            template={template}
            trigger={
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-8 w-8"
                aria-label="Duplicate"
              >
                <Copy className="h-3.5 w-3.5" />
              </Button>
            }
          />
          <ToggleActiveButton
            templateId={template.id}
            isActive={template.isActive}
          />
          <DeleteTemplateButton
            templateId={template.id}
            templateName={template.name}
          />
        </div>
      </CardContent>
    </Card>
  )
}

function ToggleActiveButton({
  templateId,
  isActive,
}: {
  templateId: string
  isActive: boolean
}) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  async function handleToggle() {
    if (pending) return
    setPending(true)
    try {
      const res = await fetch(
        `/api/admin/report-templates/${templateId}/toggle`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ isActive: !isActive }),
        }
      )
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error ?? `HTTP ${res.status}`)
      }
      router.refresh()
    } catch (err) {
      toast.error('Could not toggle status', {
        description: err instanceof Error ? err.message : 'Please try again.',
      })
    } finally {
      setPending(false)
    }
  }
  return (
    <Button
      type="button"
      size="icon"
      variant="ghost"
      onClick={handleToggle}
      disabled={pending}
      className="h-8 w-8"
      aria-label={isActive ? 'Deactivate' : 'Activate'}
    >
      {pending ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : isActive ? (
        <ToggleRight className="h-3.5 w-3.5" />
      ) : (
        <ToggleLeft className="h-3.5 w-3.5" />
      )}
    </Button>
  )
}

function DeleteTemplateButton({
  templateId,
  templateName,
}: {
  templateId: string
  templateName: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)

  async function handleDelete() {
    if (pending) return
    setPending(true)
    try {
      const res = await fetch(
        `/api/admin/report-templates/${templateId}/delete`,
        { method: 'POST' }
      )
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error ?? `HTTP ${res.status}`)
      }
      toast.success('Template deleted')
      setOpen(false)
      router.refresh()
    } catch (err) {
      toast.error('Could not delete template', {
        description: err instanceof Error ? err.message : 'Please try again.',
      })
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        onClick={() => setOpen(true)}
        className="ml-auto h-8 w-8 text-muted-foreground hover:text-destructive"
        aria-label="Delete"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete template?</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          This permanently removes{' '}
          <span className="font-medium text-foreground">{templateName}</span>.
          Past inspections that used this template are unaffected.
        </p>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline" disabled={pending}>
              Cancel
            </Button>
          </DialogClose>
          <Button
            type="button"
            onClick={handleDelete}
            disabled={pending}
            className="gap-1.5 bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
