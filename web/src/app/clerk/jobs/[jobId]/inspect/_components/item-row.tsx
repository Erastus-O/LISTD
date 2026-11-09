'use client'

import { useState } from 'react'
import { Loader2, Sparkles, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { PhotoUploader, type ManagedPhoto } from './photo-uploader'
import type { BaselinePhoto } from '@/lib/inspect/baseline-key'

/**
 * One item inside a room (sofa, oven, walls, etc.). The clerk types a
 * free-text **description** of the item plus a free-text **condition**
 * narrative, and attaches up to a handful of photos. The previous
 * Condition/Cleanliness dropdowns were too rigid for what inventory
 * clerks actually write — "minor scratch on the top-left corner,
 * otherwise in good order" doesn't fit a five-value enum.
 *
 * Photos upload browser-direct to the `generated-reports` bucket under
 * `<jobId>/inspection-photos/...`.
 */
export type ItemDraft = {
  clientId: string
  itemName: string
  /** What the item is (or descriptive notes about it). Maps to
   *  `inspection_items.description` on submit. */
  description: string
  /** Free-text condition narrative. Maps to
   *  `inspection_items.condition_notes` on submit (the enum
   *  `condition` column is left null on new submissions). */
  condition: string
  photos: ManagedPhoto[]
}

/** Kept exported (was used by older callers) — the type is still
 *  consumed by render-pdf for legacy reports that stored the enum. */
export type ConditionRating =
  | 'excellent'
  | 'good'
  | 'fair'
  | 'poor'
  | 'damaged'
  | 'missing'
  | 'na'

type Props = {
  item: ItemDraft
  jobId: string
  disabled?: boolean
  onChange: (next: ItemDraft) => void
  onRemove: () => void
  /** "Before" photos for this item from the property's prior inspection. */
  beforePhotos?: BaselinePhoto[]
}

export function ItemRow({
  item,
  jobId,
  disabled,
  onChange,
  onRemove,
  beforePhotos = [],
}: Props) {
  const update = (patch: Partial<ItemDraft>) => onChange({ ...item, ...patch })
  // Tracks which field (if any) is currently being drafted by the AI.
  const [aiBusy, setAiBusy] = useState<null | 'description' | 'condition'>(null)
  const hasPhoto = item.photos.length > 0
  const itemNameTrimmed = item.itemName.trim()

  /**
   * Clerk-initiated AI assist, per field. The clerk chooses whether to draft
   * the **description** (almost always wanted) and/or the **condition** (opt-in
   * — only peculiar cases need an AI condition note). Each button only requests
   * its own field, so condition tokens aren't spent unless the clerk asks.
   * Never fires automatically.
   */
  async function handleAiAssist(field: 'description' | 'condition') {
    if (aiBusy) return
    if (!hasPhoto) {
      toast.error('Add a photo first so the AI has something to look at.')
      return
    }
    if (!itemNameTrimmed) {
      toast.error('Name the item first: gives the AI context.')
      return
    }
    setAiBusy(field)
    try {
      const res = await fetch('/api/clerk/ai/item-condition', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId,
          itemName: itemNameTrimmed,
          photoUrl: item.photos[0]!.url,
          currentDescription: item.description || null,
          field,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error ?? `HTTP ${res.status}`)
      }
      const json = (await res.json()) as {
        description?: string
        condition?: string
      }
      const value = field === 'description' ? json.description : json.condition
      if (value) {
        update(
          field === 'description'
            ? { description: value }
            : { condition: value }
        )
        toast.success(`AI ${field} added : review and edit before submitting.`)
      } else {
        toast.message('AI had nothing to add for that field: try again.')
      }
    } catch (err) {
      toast.error('AI assist failed', {
        description:
          err instanceof Error ? err.message : 'Please try again later.',
      })
    } finally {
      setAiBusy(null)
    }
  }

  return (
    <div className="rounded-lg border border-border bg-background p-3 text-xs">
      <div className="flex items-start gap-2">
        <Input
          value={item.itemName}
          onChange={(e) => update({ itemName: e.target.value })}
          disabled={disabled}
          className="h-8 text-xs"
          aria-label="Item name"
          placeholder="Item name"
        />
        <Button
          type="button"
          size="icon"
          variant="ghost"
          onClick={onRemove}
          disabled={disabled}
          className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
          aria-label="Remove item"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div>
          <div className="flex items-center justify-between">
            <Label className="text-[11px] text-muted-foreground">
              Description
            </Label>
            <AiFieldButton
              label="AI describe"
              busy={aiBusy === 'description'}
              disabled={!!disabled || !!aiBusy || !hasPhoto}
              title={
                !hasPhoto
                  ? 'Add a photo to enable AI assist'
                  : 'Draft the description from the first photo'
              }
              onClick={() => handleAiAssist('description')}
            />
          </div>
          <Textarea
            value={item.description}
            onChange={(e) => update({ description: e.target.value })}
            disabled={disabled || aiBusy === 'description'}
            rows={2}
            className="mt-1 text-xs"
            placeholder="What the item is, any defining detail (colour, size, brand)…"
          />
        </div>
        <div>
          <div className="flex items-center justify-between">
            <Label className="text-[11px] text-muted-foreground">
              Condition
            </Label>
            <AiFieldButton
              label="AI condition"
              busy={aiBusy === 'condition'}
              disabled={!!disabled || !!aiBusy || !hasPhoto}
              title={
                !hasPhoto
                  ? 'Add a photo to enable AI assist'
                  : 'Optional: draft a condition note from the first photo'
              }
              onClick={() => handleAiAssist('condition')}
            />
          </div>
          <Textarea
            value={item.condition}
            onChange={(e) => update({ condition: e.target.value })}
            disabled={disabled || aiBusy === 'condition'}
            rows={2}
            className="mt-1 text-xs"
            placeholder="Observed condition: wear, damage, missing parts, anything QA should see."
          />
        </div>
      </div>

      {beforePhotos.length > 0 && (
        <div className="mt-2 rounded-md border border-amber-300/60 bg-amber-50/60 p-2">
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
            Before · prior inspection
          </p>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {beforePhotos.map((p, i) => (
              <a
                key={i}
                href={p.previewUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="relative block aspect-square overflow-hidden rounded-md border border-border bg-muted"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- signed remote URL preview */}
                <img
                  src={p.previewUrl}
                  alt="Before"
                  className="absolute inset-0 h-full w-full object-cover"
                />
              </a>
            ))}
          </div>
        </div>
      )}

      <div className="mt-2">
        <PhotoUploader
          jobId={jobId}
          photos={item.photos}
          disabled={disabled}
          onChange={(next) => update({ photos: next })}
          label={beforePhotos.length > 0 ? 'After · this inspection' : 'Item photos'}
          max={6}
        />
      </div>
    </div>
  )
}

/** Small per-field AI-assist button (description / condition). */
function AiFieldButton({
  label,
  busy,
  disabled,
  title,
  onClick,
}: {
  label: string
  busy: boolean
  disabled: boolean
  title: string
  onClick: () => void
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="h-6 gap-1 px-1.5 text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-50"
    >
      {busy ? (
        <>
          <Loader2 className="h-3 w-3 animate-spin" />
          Thinking…
        </>
      ) : (
        <>
          <Sparkles className="h-3 w-3" />
          {label}
        </>
      )}
    </Button>
  )
}

export function emptyItem(name: string): ItemDraft {
  return {
    clientId: `${name}-${Math.random().toString(36).slice(2, 8)}`,
    itemName: name,
    description: '',
    condition: '',
    photos: [],
  }
}
