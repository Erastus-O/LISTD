'use client'

import { useState } from 'react'
import { ChevronDown, ChevronRight, GripVertical, Plus } from 'lucide-react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { ROOM_TYPE_LABELS, type RoomType } from '@/lib/inspection/build-rooms'
import {
  ItemRow,
  emptyItem,
  type ConditionRating,
  type ItemDraft,
} from './item-row'
import { baselineKey, type BaselineData } from '@/lib/inspect/baseline-key'
import { PhotoUploader, type ManagedPhoto } from './photo-uploader'

export type RoomDraft = {
  clientId: string
  name: string
  roomType: RoomType
  overallCondition: ConditionRating | null
  notes: string
  items: ItemDraft[]
  photos: ManagedPhoto[]
}

const OVERALL_CONDITIONS: { value: ConditionRating; label: string }[] = [
  { value: 'excellent', label: 'Excellent' },
  { value: 'good', label: 'Good' },
  { value: 'fair', label: 'Fair' },
  { value: 'poor', label: 'Poor' },
  { value: 'damaged', label: 'Damaged' },
]

type Props = {
  room: RoomDraft
  jobId: string
  disabled?: boolean
  onChange: (next: RoomDraft) => void
  onRemove?: () => void
  /** Before/after baseline for the property (most recent prior inspection). */
  baseline?: BaselineData | null
}

/**
 * One room section in the inspection wizard. Collapsible — large jobs (5
 * bedrooms + utility) can have 50+ items, so we want clerks to focus one
 * room at a time. Completion progress shows how many items have a
 * condition picked vs total.
 */
export function RoomSection({
  room,
  jobId,
  disabled,
  onChange,
  onRemove,
  baseline,
}: Props) {
  const [open, setOpen] = useState(true)
  const update = (patch: Partial<RoomDraft>) => onChange({ ...room, ...patch })

  // Drag-to-reorder. The handle is a separate element so the rest of the
  // header (collapse toggle, inputs) keeps its normal click behaviour;
  // only the grip activates a drag, which matters on touch where the
  // entire row can scroll.
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: room.clientId, disabled })

  const sortableStyle = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  const completedItems = room.items.filter((i) => i.condition !== null).length
  const totalItems = room.items.length
  const completePct =
    totalItems === 0 ? 0 : Math.round((completedItems / totalItems) * 100)

  return (
    <Card
      ref={setNodeRef}
      style={sortableStyle}
      className={cn(
        isDragging && 'z-10 opacity-90 shadow-lg ring-1 ring-primary/40'
      )}
    >
      <div className="flex items-stretch">
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          aria-label={`Reorder ${room.name}`}
          disabled={disabled}
          className="flex shrink-0 cursor-grab touch-none items-center justify-center self-stretch px-3 text-muted-foreground transition-colors hover:text-foreground active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-50"
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex flex-1 items-center justify-between gap-3 p-4 pl-1 text-left"
          aria-expanded={open}
        >
          <div className="flex min-w-0 items-center gap-2">
            {open ? (
              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            )}
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-foreground">
                {room.name}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {ROOM_TYPE_LABELS[room.roomType]} · {completedItems}/{totalItems}{' '}
                items checked
              </p>
            </div>
          </div>
          <div
            className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-muted"
            aria-hidden
          >
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${completePct}%` }}
            />
          </div>
        </button>
      </div>

      {open && (
        <CardContent className="space-y-4 border-t border-border p-4 pt-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-[11px] text-muted-foreground">
                Room name
              </Label>
              <Input
                value={room.name}
                onChange={(e) => update({ name: e.target.value })}
                disabled={disabled}
                className="mt-1 h-8 text-xs"
              />
            </div>
            <div>
              <Label className="text-[11px] text-muted-foreground">
                Overall condition
              </Label>
              <Select
                value={room.overallCondition ?? undefined}
                onValueChange={(v) =>
                  update({ overallCondition: v as ConditionRating })
                }
                disabled={disabled}
              >
                <SelectTrigger className="mt-1 h-8 text-xs">
                  <SelectValue placeholder="Select…" />
                </SelectTrigger>
                <SelectContent>
                  {OVERALL_CONDITIONS.map((c) => (
                    <SelectItem key={c.value} value={c.value}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold">Items</Label>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() =>
                  update({ items: [...room.items, emptyItem('New item')] })
                }
                disabled={disabled}
                className="h-7 gap-1 px-2 text-[11px]"
              >
                <Plus className="h-3 w-3" />
                Add item
              </Button>
            </div>
            {room.items.length === 0 ? (
              <p className="rounded-md border border-dashed border-border p-3 text-center text-[11px] text-muted-foreground">
                No items yet. Add one above.
              </p>
            ) : (
              <div className="space-y-2">
                {room.items.map((item, i) => (
                  <ItemRow
                    key={item.clientId}
                    item={item}
                    jobId={jobId}
                    disabled={disabled}
                    beforePhotos={
                      baseline?.byRoomItem[
                        baselineKey(room.name, item.itemName)
                      ] ?? []
                    }
                    onChange={(next) => {
                      const items = [...room.items]
                      items[i] = next
                      update({ items })
                    }}
                    onRemove={() =>
                      update({
                        items: room.items.filter(
                          (x) => x.clientId !== item.clientId
                        ),
                      })
                    }
                  />
                ))}
              </div>
            )}
          </div>

          <PhotoUploader
            jobId={jobId}
            photos={room.photos}
            disabled={disabled}
            onChange={(next) => update({ photos: next })}
            label="Room photos"
            max={12}
          />

          <div>
            <Label className="text-[11px] text-muted-foreground">
              Room notes (optional)
            </Label>
            <Textarea
              value={room.notes}
              onChange={(e) => update({ notes: e.target.value })}
              disabled={disabled}
              rows={2}
              className="mt-1 text-xs"
              placeholder="General observations for this room"
            />
          </div>

          {onRemove && (
            <div className="flex justify-end">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={onRemove}
                disabled={disabled}
                className="h-7 px-2 text-[11px] text-muted-foreground hover:text-destructive"
              >
                Remove room
              </Button>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  )
}
