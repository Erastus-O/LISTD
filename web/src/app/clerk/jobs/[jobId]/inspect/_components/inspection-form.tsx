'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, Loader2, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { createClient } from '@/lib/supabase/client'
import { namesMatch } from '@/lib/name-match'
import {
  AdoptSignature,
  type AdoptedSignature,
} from '@/components/signature/adopt-signature'
import {
  ROOM_TYPE_LABELS,
  type DerivedRoom,
  type RoomType,
} from '@/lib/inspection/build-rooms'
import { getItemsForRoomType } from '@/lib/inspection/item-templates'
import type { PriorSubmission } from '@/lib/inspect/prior-submission'
import {
  clearInspectDraft,
  isMeaningfulInspectDraft,
  loadInspectDraft,
  saveInspectDraft,
} from '@/lib/inspect/draft'
import { emptyItem, type ItemDraft } from './item-row'
import type { ManagedPhoto } from './photo-uploader'
import { RoomSection, type RoomDraft } from './room-section'
import type { BaselineData } from '@/lib/inspect/baseline-key'

type Props = {
  jobId: string
  initialRooms: DerivedRoom[]
  /** Pre-fill the clerk's typed name. */
  defaultClerkName?: string | null
  /** Prior submission to hydrate from when admin has returned the
   *  report for amends. Falls through to `initialRooms` when null. */
  priorSubmission?: PriorSubmission | null
  /** Mobile PWA captures reshaped as a submission — pre-loads on-site
   *  photos under their rooms/items, descriptions + conditions blank.
   *  Lower precedence than `priorSubmission`; both are PriorSubmission-
   *  shaped so the same `buildRoomsFromPrior` seeds either. */
  mobileCaptures?: PriorSubmission | null
  /** Before/after baseline: the property's most recent prior inspection's
   *  photos, keyed by room+item, shown as "Before" on each item. */
  baseline?: BaselineData | null
}

type MeterRow = {
  id: string
  /** Name shown in column 1, e.g. "Gas Meter". */
  label: string
  /** Serial number printed on the meter face. */
  serialNumber: string
  /** Reading captured. */
  value: string
  /** Where the meter sits — "Garage", "Cupboard on the landing", etc. */
  location: string
  /** Supplier the meter is billed to, e.g. "British Gas". */
  supplier: string
}

/**
 * Top-level state for the structured clerk inspection wizard. Orchestrates:
 *
 *   - Per-room state (items, condition, cleanliness, notes, photos)
 *   - Property-wide checks (smoke / CO alarms, meter readings)
 *   - General notes + clerk typed signature
 *   - Submit: posts the full payload to
 *     `/api/clerk/jobs/[jobId]/inspection/submit` which persists every row
 *     and renders the PDF server-side
 *
 * Photos are uploaded browser-direct from the per-room / per-item
 * `PhotoUploader` components; by the time this form submits, every
 * photo URL is already live in `generated-reports/<jobId>/...`.
 */
export function InspectionForm({
  jobId,
  initialRooms,
  defaultClerkName,
  priorSubmission,
  mobileCaptures,
  baseline,
}: Props) {
  const router = useRouter()
  // A returned report and on-site mobile captures are both
  // PriorSubmission-shaped seeds; returned wins (it's a fuller, already
  // written-up report). Everything below seeds from `seed`.
  const seed = priorSubmission ?? mobileCaptures ?? null
  // Initialised after mount so SSR and client hydration agree on the
  // empty placeholder — `new Date()` at module init produces different
  // values on the server vs the client and trips React #418 hydration
  // text-content mismatch on the "Started 12:34:56" line below.
  const [startedAt, setStartedAt] = useState<Date | null>(null)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot mount-time start timestamp
    setStartedAt(new Date())
  }, [])

  // Initial state precedence is: localStorage draft (set in the mount
  // effect below) > prior submission (admin-returned report) >
  // freshly-derived empty rooms. The `useState` initialisers below
  // start with derived/empty; the effect overlays a draft if one
  // exists. Prior submission is the SECOND-best signal and is the
  // server-provided seed.
  const seedRooms = seed
    ? buildRoomsFromPrior(seed)
    : initialRooms.map(buildRoomDraft)
  const [rooms, setRooms] = useState<RoomDraft[]>(seedRooms)
  const [draftRestored, setDraftRestored] = useState(false)
  // Block draft writes until the restore-on-mount effect has run,
  // otherwise the very first save (with the seed state) overwrites a
  // real saved draft before we get a chance to restore it.
  const hydratedRef = useRef(false)

  // dnd-kit sensors. PointerSensor's small activation distance keeps a
  // mouse-down on a Card body from starting a drag accidentally. TouchSensor
  // uses a short delay so vertical page-scroll on a phone still works — a
  // clerk has to hold the grip briefly to start dragging. KeyboardSensor is
  // the accessibility path (tab to the grip, Space to pick up, arrows to
  // move, Space to drop).
  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 6 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  function handleRoomDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    setRooms((prev) => {
      const oldIndex = prev.findIndex((r) => r.clientId === active.id)
      const newIndex = prev.findIndex((r) => r.clientId === over.id)
      if (oldIndex < 0 || newIndex < 0) return prev
      return arrayMove(prev, oldIndex, newIndex)
    })
  }
  const [generalNotes, setGeneralNotes] = useState(seed?.generalNotes ?? '')
  const [smokeAlarmsChecked, setSmokeAlarmsChecked] = useState(
    seed?.smokeAlarmsChecked ?? false
  )
  const [carbonMonoxideChecked, setCarbonMonoxideChecked] = useState(
    seed?.carbonMonoxideChecked ?? false
  )
  const [meters, setMeters] = useState<MeterRow[]>(seed?.meters ?? [])
  const [clerkTypedName, setClerkTypedName] = useState(defaultClerkName ?? '')
  const [clerkSignature, setClerkSignature] =
    useState<AdoptedSignature | null>(null)
  const [declaration, setDeclaration] = useState(false)
  const [pending, setPending] = useState(false)

  // Restore localStorage draft on mount. Draft wins over prior
  // submission (clerk was actively editing). After restore, re-sign
  // every photo's preview URL — the signed URLs in the draft expire
  // after an hour and the bucket is private.
  useEffect(() => {
    const draft = loadInspectDraft(jobId)
    if (draft && isMeaningfulInspectDraft(draft)) {
      /* eslint-disable react-hooks/set-state-in-effect -- one-shot mount-time draft restore */
      setRooms(draft.rooms)
      setGeneralNotes(draft.generalNotes)
      setSmokeAlarmsChecked(draft.smokeAlarmsChecked)
      setCarbonMonoxideChecked(draft.carbonMonoxideChecked)
      setMeters(draft.meters)
      setDraftRestored(true)
      /* eslint-enable react-hooks/set-state-in-effect */
      // Re-sign photo preview URLs (don't await — thumbnails just
      // appear when they're ready).
      void resignDraftPhotos(jobId, draft.rooms, setRooms)
      toast.message('Draft restored', {
        description: "Picked up where you left off: Start fresh in the menu.",
      })
    }
    hydratedRef.current = true
  }, [jobId])

  // Save on change (debounced — the description/condition textareas
  // would otherwise hammer localStorage on every keystroke).
  useEffect(() => {
    if (!hydratedRef.current) return
    const handle = setTimeout(() => {
      saveInspectDraft(jobId, {
        rooms,
        generalNotes,
        meters,
        smokeAlarmsChecked,
        carbonMonoxideChecked,
      })
    }, 400)
    return () => clearTimeout(handle)
  }, [
    jobId,
    rooms,
    generalNotes,
    meters,
    smokeAlarmsChecked,
    carbonMonoxideChecked,
  ])

  const stats = useMemo(() => {
    let totalItems = 0
    let completedItems = 0
    let totalPhotos = 0
    for (const r of rooms) {
      totalItems += r.items.length
      completedItems += r.items.filter(
        (i) => i.condition.trim().length > 0
      ).length
      totalPhotos += r.photos.length
      for (const i of r.items) totalPhotos += i.photos.length
    }
    return { totalItems, completedItems, totalPhotos }
  }, [rooms])

  function addCustomRoom(roomType: RoomType) {
    setRooms((prev) => [
      ...prev,
      buildRoomDraft({
        clientId: `${roomType}-extra-${Math.random().toString(36).slice(2, 6)}`,
        name: ROOM_TYPE_LABELS[roomType],
        roomType,
        order: prev.length,
      }),
    ])
  }

  async function handleSubmit() {
    if (pending) return
    if (!clerkSignature) {
      toast.error('Adopt a signature before submitting.')
      return
    }
    if (!clerkTypedName.trim()) {
      toast.error('Type your name to sign off')
      return
    }
    if (!declaration) {
      toast.error('Please confirm the declaration')
      return
    }
    if (stats.totalItems === 0) {
      toast.error('Add at least one item to the inspection')
      return
    }
    if (stats.completedItems < stats.totalItems) {
      const skipped = stats.totalItems - stats.completedItems
      const proceed = confirm(
        `${skipped} item${skipped === 1 ? '' : 's'} have no condition recorded. Submit anyway?`
      )
      if (!proceed) return
    }

    setPending(true)
    try {
      const payload = {
        rooms: rooms.map((r) => ({
          name: r.name.trim() || ROOM_TYPE_LABELS[r.roomType],
          roomType: r.roomType,
          overallCondition: r.overallCondition,
          notes: r.notes.trim() || null,
          items: r.items.map((i) => ({
            itemName: i.itemName.trim() || 'Item',
            description: i.description.trim() || null,
            condition: i.condition.trim() || null,
            photoUrls: i.photos.map((p) => p.url),
          })),
          photoUrls: r.photos.map((p) => p.url),
        })),
        generalNotes: generalNotes.trim() || null,
        // Submit any row that has *something* worth recording — at minimum
        // a name + (reading OR a serial OR a location). Empty rows are
        // dropped silently so clerks don't have to manually remove the
        // blank one they accidentally tapped "Add reading" for.
        meterReadings: meters
          .filter(
            (m) =>
              m.label.trim() &&
              (m.value.trim() || m.serialNumber.trim() || m.location.trim())
          )
          .map((m) => ({
            label: m.label.trim(),
            value: m.value.trim(),
            serialNumber: m.serialNumber.trim() || null,
            location: m.location.trim() || null,
            supplier: m.supplier.trim() || null,
          })),
        smokeAlarmsChecked,
        carbonMonoxideChecked,
        clerkTypedName: clerkTypedName.trim(),
        clerkSignatureImage: clerkSignature?.dataUrl ?? null,
        clerkSignatureMode: clerkSignature?.mode ?? null,
        // `startedAt` is set right after mount via the effect above; the
        // ?? branch is just a paranoia fallback in case submit somehow
        // fires before the next render. Stamps a fresh `now`.
        inspectionStartedAt: (startedAt ?? new Date()).toISOString(),
        inspectionCompletedAt: new Date().toISOString(),
      }

      const res = await fetch(
        `/api/clerk/jobs/${jobId}/inspection/submit`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      )
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error ?? `HTTP ${res.status}`)
      }
      // Drop the local draft — the submission is now the source of
      // truth. If admin returns it for amends, the page hydrates from
      // the persisted prior submission, not the (now-stale) draft.
      clearInspectDraft(jobId)
      toast.success('Report submitted', {
        description: 'A reviewer will check it shortly.',
      })
      router.push(`/clerk/jobs/${jobId}`)
      router.refresh()
    } catch (err) {
      toast.error('Could not submit report', {
        description: err instanceof Error ? err.message : 'Please try again.',
      })
      setPending(false)
    }
  }

  function handleStartFresh() {
    if (
      typeof window !== 'undefined' &&
      !window.confirm(
        'Discard the saved draft and start from a blank inspection? This cannot be undone.'
      )
    ) {
      return
    }
    clearInspectDraft(jobId)
    setRooms(seedRooms)
    setGeneralNotes(seed?.generalNotes ?? '')
    setSmokeAlarmsChecked(seed?.smokeAlarmsChecked ?? false)
    setCarbonMonoxideChecked(seed?.carbonMonoxideChecked ?? false)
    setMeters(seed?.meters ?? [])
    setDraftRestored(false)
    toast.success('Draft discarded')
  }

  return (
    <div className="space-y-6">
      {draftRestored && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-3 text-xs">
            <span className="text-foreground">
              Saved draft restored: every change is auto-saved as you go.
            </span>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={handleStartFresh}
              className="h-7 gap-1 px-2 text-[11px]"
            >
              Start fresh
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4 text-xs">
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-muted-foreground">
            <span>
              <strong className="text-foreground">{rooms.length}</strong> rooms
            </span>
            <span>
              <strong className="text-foreground">{stats.completedItems}</strong>
              /<span className="text-foreground">{stats.totalItems}</span> items
              checked
            </span>
            <span>
              <strong className="text-foreground">{stats.totalPhotos}</strong> photos
            </span>
          </div>
          <span className="text-muted-foreground">
            Started {startedAt ? startedAt.toLocaleTimeString() : '—'}
          </span>
        </CardContent>
      </Card>

      <DndContext
        sensors={dndSensors}
        collisionDetection={closestCenter}
        onDragEnd={handleRoomDragEnd}
      >
        <SortableContext
          items={rooms.map((r) => r.clientId)}
          strategy={verticalListSortingStrategy}
        >
          <div className="space-y-3">
            {rooms.map((room, idx) => (
              <RoomSection
                key={room.clientId}
                room={room}
                jobId={jobId}
                disabled={pending}
                baseline={baseline ?? null}
                onChange={(next) => {
                  const copy = [...rooms]
                  copy[idx] = next
                  setRooms(copy)
                }}
                onRemove={
                  rooms.length > 1
                    ? () =>
                        setRooms((prev) =>
                          prev.filter((r) => r.clientId !== room.clientId)
                        )
                    : undefined
                }
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      <Card>
        <CardContent className="space-y-3 p-4">
          <h2 className="text-sm font-semibold">Add additional room</h2>
          <p className="text-[11px] text-muted-foreground">
            The default rooms come from the property record. Add anything
            else the property has: outbuildings, balconies, etc.
          </p>
          <div className="flex flex-wrap gap-2">
            {(
              ['entrance', 'toilet', 'garage', 'balcony', 'other'] as RoomType[]
            ).map((rt) => (
              <Button
                key={rt}
                type="button"
                size="sm"
                variant="outline"
                onClick={() => addCustomRoom(rt)}
                disabled={pending}
                className="h-7 gap-1 px-2 text-[11px]"
              >
                <Plus className="h-3 w-3" />
                {ROOM_TYPE_LABELS[rt]}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 p-4">
          <h2 className="text-sm font-semibold">Property-wide checks</h2>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={smokeAlarmsChecked}
              onChange={(e) => setSmokeAlarmsChecked(e.target.checked)}
              disabled={pending}
              className="h-3.5 w-3.5"
            />
            Smoke alarms tested and working
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={carbonMonoxideChecked}
              onChange={(e) => setCarbonMonoxideChecked(e.target.checked)}
              disabled={pending}
              className="h-3.5 w-3.5"
            />
            CO alarms tested and working
          </label>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <Label className="text-[11px] text-muted-foreground">
                Meter readings
              </Label>
              <div className="flex flex-wrap items-center gap-1.5">
                {(['Gas Meter', 'Electric Meter', 'Water Meter'] as const).map(
                  (preset) => (
                    <Button
                      key={preset}
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        setMeters((prev) => [...prev, blankMeter(preset)])
                      }
                      disabled={pending}
                      className="h-7 gap-1 px-2 text-[11px]"
                    >
                      <Plus className="h-3 w-3" />
                      {preset.replace(' Meter', '')}
                    </Button>
                  )
                )}
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    setMeters((prev) => [...prev, blankMeter('')])
                  }
                  disabled={pending}
                  className="h-7 gap-1 px-2 text-[11px]"
                >
                  <Plus className="h-3 w-3" />
                  Other
                </Button>
              </div>
            </div>
            {meters.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">
                None recorded. Use the quick-add buttons above for gas /
                electricity / water, or &quot;Other&quot; for anything else.
              </p>
            ) : (
              <div className="space-y-3">
                {meters.map((m, idx) => (
                  <div
                    key={m.id}
                    className="rounded-lg border border-border bg-muted/20 p-3"
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-[11px] font-semibold text-muted-foreground">
                        Meter {idx + 1}
                      </span>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        onClick={() =>
                          setMeters((prev) => prev.filter((x) => x.id !== m.id))
                        }
                        disabled={pending}
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        aria-label="Remove reading"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <MeterField
                        label="Name"
                        value={m.label}
                        placeholder="e.g. Gas Meter"
                        disabled={pending}
                        onChange={(v) =>
                          updateMeter(setMeters, m.id, { label: v })
                        }
                      />
                      <MeterField
                        label="Serial No."
                        value={m.serialNumber}
                        placeholder="e.g. K92D0637"
                        disabled={pending}
                        onChange={(v) =>
                          updateMeter(setMeters, m.id, { serialNumber: v })
                        }
                      />
                      <MeterField
                        label="Reading"
                        value={m.value}
                        placeholder="e.g. 228639 kWh"
                        disabled={pending}
                        onChange={(v) =>
                          updateMeter(setMeters, m.id, { value: v })
                        }
                      />
                      <MeterField
                        label="Location"
                        value={m.location}
                        placeholder="e.g. Garage / Cupboard on landing"
                        disabled={pending}
                        onChange={(v) =>
                          updateMeter(setMeters, m.id, { location: v })
                        }
                      />
                      <MeterField
                        label="Supplier"
                        value={m.supplier}
                        placeholder="e.g. British Gas"
                        disabled={pending}
                        onChange={(v) =>
                          updateMeter(setMeters, m.id, { supplier: v })
                        }
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-2 p-4">
          <Label className="text-xs font-semibold">General notes</Label>
          <Textarea
            value={generalNotes}
            onChange={(e) => setGeneralNotes(e.target.value)}
            disabled={pending}
            rows={3}
            className="text-xs"
            placeholder="Anything QA should know that doesn't fit on a room or item: access issues, tenant interactions, etc."
          />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 p-4">
          <h2 className="text-sm font-semibold">Sign-off</h2>
          <div>
            <Label className="text-[11px] text-muted-foreground">
              Type your full name as signature
            </Label>
            <Input
              value={clerkTypedName}
              onChange={(e) => setClerkTypedName(e.target.value)}
              disabled={pending}
              className="mt-1 h-9 font-serif italic"
              placeholder="Full name"
            />
            {clerkTypedName.trim().length > 0 &&
              defaultClerkName &&
              !namesMatch(clerkTypedName, defaultClerkName) && (
                <p className="mt-1 text-xs text-amber-700">
                  This doesn&rsquo;t match the name on your profile (
                  {defaultClerkName}). You can still submit, but please
                  check for typos.
                </p>
              )}
          </div>
          <div>
            <Label className="text-[11px] text-muted-foreground">
              Your signature
            </Label>
            <div className="mt-1">
              <AdoptSignature
                fullName={clerkTypedName}
                value={clerkSignature}
                onChange={setClerkSignature}
                disabled={pending}
              />
            </div>
          </div>
          <label className="flex items-start gap-2.5">
            <input
              type="checkbox"
              checked={declaration}
              onChange={(e) => setDeclaration(e.target.checked)}
              disabled={pending}
              className="mt-0.5 h-4 w-4"
            />
            <span className="text-xs leading-relaxed text-foreground">
              I confirm this report accurately reflects what I observed during
              the inspection. I understand the report is sent for QA review
              and may be returned for amends if the reviewer flags issues.
            </span>
          </label>
        </CardContent>
      </Card>

      <Button
        type="button"
        onClick={handleSubmit}
        disabled={
          pending || !clerkTypedName.trim() || !clerkSignature || !declaration
        }
        className="w-full gap-1.5"
      >
        {pending ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Submitting…
          </>
        ) : (
          <>
            <CheckCircle2 className="h-4 w-4" />
            Submit inspection
          </>
        )}
      </Button>
    </div>
  )
}

/**
 * After restoring a localStorage draft, refresh every photo's signed
 * preview URL. The signed URLs in the draft expire after an hour, so
 * a clerk returning to the form after lunch sees broken thumbnails
 * unless we re-sign. Storage paths in the draft don't change; we just
 * ask Supabase for a fresh signed URL per path and patch the state.
 */
async function resignDraftPhotos(
  jobId: string,
  draftRooms: RoomDraft[],
  setRooms: React.Dispatch<React.SetStateAction<RoomDraft[]>>
): Promise<void> {
  const allPaths = new Set<string>()
  for (const r of draftRooms) {
    for (const p of r.photos) if (p.storagePath) allPaths.add(p.storagePath)
    for (const i of r.items)
      for (const p of i.photos) if (p.storagePath) allPaths.add(p.storagePath)
  }
  if (allPaths.size === 0) return
  const supabase = createClient()
  const fresh = new Map<string, string>()
  await Promise.all(
    Array.from(allPaths).map(async (path) => {
      const { data } = await supabase.storage
        .from('generated-reports')
        .createSignedUrl(path, 60 * 60)
      if (data?.signedUrl) fresh.set(path, data.signedUrl)
    })
  )
  if (fresh.size === 0) return
  setRooms((prev) =>
    prev.map((r) => ({
      ...r,
      photos: r.photos.map((p) => ({
        ...p,
        previewUrl: fresh.get(p.storagePath) ?? p.previewUrl,
      })),
      items: r.items.map((i) => ({
        ...i,
        photos: i.photos.map((p) => ({
          ...p,
          previewUrl: fresh.get(p.storagePath) ?? p.previewUrl,
        })),
      })),
    }))
  )
  // Reference `jobId` so a future revision of this helper that needs
  // it for logging or scoped storage doesn't have to re-thread the
  // arg through the call sites.
  void jobId
}

function buildRoomDraft(r: DerivedRoom): RoomDraft {
  return {
    clientId: r.clientId,
    name: r.name,
    roomType: r.roomType,
    overallCondition: null,
    notes: '',
    items: getItemsForRoomType(r.roomType).map((name) => emptyItem(name)),
    photos: [],
  }
}

/** Hydrate the room/item/photo state from a `PriorSubmission` — the
 *  shape the form already keeps in `useState`. Used on first mount
 *  when admin has returned the report for amends; the clerk sees their
 *  previous answers and edits in place. */
function buildRoomsFromPrior(prior: PriorSubmission): RoomDraft[] {
  return prior.rooms.map((r) => ({
    clientId: r.clientId,
    name: r.name,
    roomType: r.roomType,
    overallCondition: (r.overallCondition ?? null) as RoomDraft['overallCondition'],
    notes: r.notes,
    items: r.items.map(
      (it): ItemDraft => ({
        clientId: it.clientId,
        itemName: it.itemName,
        description: it.description,
        condition: it.condition,
        photos: it.photos.map(
          (p): ManagedPhoto => ({
            clientId: p.clientId,
            url: p.url,
            storagePath: p.storagePath,
            previewUrl: p.previewUrl,
          })
        ),
      })
    ),
    photos: r.photos.map(
      (p): ManagedPhoto => ({
        clientId: p.clientId,
        url: p.url,
        storagePath: p.storagePath,
        previewUrl: p.previewUrl,
      })
    ),
  }))
}

function blankMeter(label: string): MeterRow {
  return {
    id: Math.random().toString(36).slice(2, 8),
    label,
    serialNumber: '',
    value: '',
    location: '',
    supplier: '',
  }
}

function updateMeter(
  setMeters: React.Dispatch<React.SetStateAction<MeterRow[]>>,
  id: string,
  patch: Partial<MeterRow>
) {
  setMeters((prev) => prev.map((x) => (x.id === id ? { ...x, ...patch } : x)))
}

function MeterField({
  label,
  value,
  placeholder,
  disabled,
  onChange,
}: {
  label: string
  value: string
  placeholder?: string
  disabled?: boolean
  onChange: (v: string) => void
}) {
  return (
    <div>
      <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </Label>
      <Input
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 h-8 text-xs"
      />
    </div>
  )
}
