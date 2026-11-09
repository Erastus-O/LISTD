'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Clock,
  Loader2,
  MapPin,
  PhoneCall,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { createClient } from '@/lib/supabase/client'

export type SiteEventSummary = {
  id: string
  kind: 'arrival' | 'running_late' | 'no_access'
  createdAt: string
  etaMinutes: number | null
  reason: string | null
}

type Props = {
  jobId: string
  /** Which role's API namespace to POST to. */
  apiBase: '/api/clerk' | '/api/cleaner'
  /** This actor's existing site events for the job, oldest first. */
  initialEvents: SiteEventSummary[]
}

const MAX_PHOTO_BYTES = 12 * 1024 * 1024

const NO_ACCESS_REASONS: { value: string; label: string }[] = [
  { value: 'no_keys', label: 'Keys not where stated' },
  { value: 'keyholder_absent', label: 'Keyholder absent' },
  { value: 'wrong_address', label: 'Wrong address supplied' },
  { value: 'wrong_access_code', label: 'Access code wrong' },
  { value: 'property_unsafe', label: 'Property unsafe / not inspectable' },
  { value: 'tenant_refused', label: 'Tenant refused entry' },
  { value: 'other', label: 'Other' },
]

const ETA_OPTIONS = [15, 30, 45, 60, 90]

function fmtTime(iso: string): string {
  const d = new Date(iso)
  return Number.isFinite(d.getTime())
    ? d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    : ''
}

/** Best-effort geolocation — never blocks the check-in if denied/slow. */
function getPosition(): Promise<GeolocationPosition | null> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      resolve(null)
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(pos),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60_000 }
    )
  })
}

/**
 * "On-site" card for the assigned pro (clerk or cleaner): arrival check-in
 * (timestamp + optional geolocation + optional doorstep photo), a prominent
 * running-late flag, and the structured no-access report. Framework
 * §14 items 1/3/4 — the evidence layer everything else keys off.
 */
export function SiteActionsCard({ jobId, apiBase, initialEvents }: Props) {
  const router = useRouter()
  const [pending, setPending] = useState<string | null>(null)

  const arrival = initialEvents.find((e) => e.kind === 'arrival') ?? null
  const lateFlag =
    [...initialEvents].reverse().find((e) => e.kind === 'running_late') ?? null
  const noAccess =
    [...initialEvents].reverse().find((e) => e.kind === 'no_access') ?? null

  // Check-in photo
  const photoInputRef = useRef<HTMLInputElement>(null)
  const [checkinPhoto, setCheckinPhoto] = useState<File | null>(null)

  // Running-late dialog
  const [lateOpen, setLateOpen] = useState(false)
  const [eta, setEta] = useState<string>('30')
  const [lateNote, setLateNote] = useState('')

  // No-access dialog. `naOpenedAt` snapshots the clock when the dialog
  // opens so the waited-minutes readout stays pure during render.
  const [naOpen, setNaOpen] = useState(false)
  const [naOpenedAt, setNaOpenedAt] = useState<number | null>(null)
  const [naReason, setNaReason] = useState<string>('')
  const [naNote, setNaNote] = useState('')
  const [naPhotos, setNaPhotos] = useState<File[]>([])
  const [attempts, setAttempts] = useState<
    { at: string; method: 'call' | 'message' }[]
  >([])

  async function post(body: Record<string, unknown>, label: string) {
    setPending(label)
    try {
      const res = await fetch(`${apiBase}/jobs/${jobId}/site-events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const b = await res.json().catch(() => null)
        throw new Error(b?.error ?? `HTTP ${res.status}`)
      }
      return true
    } catch (err) {
      toast.error('Something went wrong', {
        description: err instanceof Error ? err.message : 'Please try again.',
      })
      return false
    } finally {
      setPending(null)
    }
  }

  async function uploadPhotos(files: File[], prefix: string) {
    const supabase = createClient()
    const paths: string[] = []
    for (const file of files) {
      if (file.size > MAX_PHOTO_BYTES) {
        toast.error(`${file.name} is too large (max 12 MB)`)
        continue
      }
      const ext = file.type.split('/')[1] ?? 'jpg'
      const path = `${jobId}/${prefix}_${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}.${ext}`
      const { error } = await supabase.storage
        .from('job-photos')
        .upload(path, file, { contentType: file.type, upsert: false })
      if (error) {
        toast.error(`Upload failed: ${error.message}`)
        continue
      }
      paths.push(path)
    }
    return paths
  }

  async function handleCheckin() {
    setPending('checkin')
    try {
      const [pos, photoPaths] = await Promise.all([
        getPosition(),
        checkinPhoto ? uploadPhotos([checkinPhoto], 'arrival') : Promise.resolve([]),
      ])
      const okPost = await post(
        {
          kind: 'arrival',
          ...(pos
            ? {
                latitude: pos.coords.latitude,
                longitude: pos.coords.longitude,
                accuracyM: pos.coords.accuracy,
              }
            : {}),
          ...(photoPaths.length > 0 ? { photoPaths } : {}),
        },
        'checkin'
      )
      if (okPost) {
        toast.success('Checked in', {
          description: pos
            ? 'Arrival recorded with your location.'
            : 'Arrival recorded. (Location unavailable — the timestamp and photo still count.)',
        })
        router.refresh()
      }
    } finally {
      setPending(null)
    }
  }

  async function handleRunningLate() {
    const okPost = await post(
      {
        kind: 'running_late',
        etaMinutes: Number(eta),
        ...(lateNote.trim() ? { note: lateNote.trim() } : {}),
      },
      'late'
    )
    if (okPost) {
      toast.success('Client notified', {
        description: `They know you're about ${eta} minutes away. Flagging early halves any lateness penalty.`,
      })
      setLateOpen(false)
      setLateNote('')
      router.refresh()
    }
  }

  const waitedMinutes =
    arrival && naOpenedAt
      ? Math.max(
          0,
          Math.round(
            (naOpenedAt - new Date(arrival.createdAt).getTime()) / 60_000
          )
        )
      : 0

  async function handleNoAccess() {
    if (!naReason) {
      toast.error('Pick a reason')
      return
    }
    setPending('no_access')
    try {
      const photoPaths = await uploadPhotos(naPhotos, 'no-access')
      const okPost = await post(
        {
          kind: 'no_access',
          reason: naReason,
          ...(naNote.trim() ? { note: naNote.trim() } : {}),
          ...(arrival ? { waitFrom: arrival.createdAt } : {}),
          waitUntil: new Date().toISOString(),
          contactAttempts: attempts.map((a) => ({
            at: a.at,
            method: a.method,
          })),
          ...(photoPaths.length > 0 ? { photoPaths } : {}),
        },
        'no_access'
      )
      if (okPost) {
        toast.success('No-access report filed', {
          description: 'Our team has been alerted and will be in touch.',
        })
        setNaOpen(false)
        router.refresh()
      }
    } finally {
      setPending(null)
    }
  }

  return (
    <Card>
      <CardContent className="space-y-3 p-5">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold">
          <MapPin className="h-4 w-4 text-primary" />
          On-site
        </h3>

        {/* ── Check-in ── */}
        {arrival ? (
          <p className="flex items-center gap-1.5 text-sm text-success">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            Checked in at {fmtTime(arrival.createdAt)}
          </p>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Check in when you arrive — it timestamps your attendance and is
              your evidence if anything goes wrong with access.
            </p>
            <input
              ref={photoInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => setCheckinPhoto(e.target.files?.[0] ?? null)}
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                onClick={handleCheckin}
                disabled={pending !== null}
                className="gap-1.5"
              >
                {pending === 'checkin' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <MapPin className="h-4 w-4" />
                )}
                Check in — I&rsquo;ve arrived
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => photoInputRef.current?.click()}
                disabled={pending !== null}
                className="gap-1.5"
              >
                <Camera className="h-3.5 w-3.5" />
                {checkinPhoto ? 'Photo attached ✓' : 'Add doorstep photo'}
              </Button>
            </div>
          </div>
        )}

        {/* ── Running late ── */}
        {!arrival && (
          <div className="border-t border-border pt-3">
            {lateFlag && (
              <p className="mb-2 flex items-center gap-1.5 text-xs text-amber-700">
                <Clock className="h-3.5 w-3.5 shrink-0" />
                Late flag sent at {fmtTime(lateFlag.createdAt)} (~
                {lateFlag.etaMinutes} min)
              </p>
            )}
            <Dialog open={lateOpen} onOpenChange={setLateOpen}>
              <DialogTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  disabled={pending !== null}
                  className="w-full gap-1.5"
                >
                  <Clock className="h-4 w-4" />
                  Running late? Tell the client now
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>Flag that you&rsquo;re running late</DialogTitle>
                </DialogHeader>
                <p className="text-xs text-muted-foreground">
                  The client is notified instantly with your ETA. An honest
                  late flag before your appointment time halves any lateness
                  penalty.
                </p>
                <div className="space-y-1.5">
                  <Label className="text-xs">How far away are you?</Label>
                  <Select value={eta} onValueChange={setEta}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ETA_OPTIONS.map((m) => (
                        <SelectItem key={m} value={String(m)}>
                          About {m} minutes
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Note for the client (optional)</Label>
                  <Textarea
                    value={lateNote}
                    onChange={(e) => setLateNote(e.target.value)}
                    rows={2}
                    className="text-sm"
                    placeholder="Traffic on the A40, sorry — nearly there."
                  />
                </div>
                <Button
                  type="button"
                  onClick={handleRunningLate}
                  disabled={pending !== null}
                  className="w-full gap-1.5"
                >
                  {pending === 'late' && (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  )}
                  Notify client
                </Button>
              </DialogContent>
            </Dialog>
          </div>
        )}

        {/* ── No access ── */}
        {arrival && (
          <div className="border-t border-border pt-3">
            {noAccess ? (
              <p className="flex items-center gap-1.5 text-xs text-amber-700">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                No-access report filed at {fmtTime(noAccess.createdAt)} — our
                team is reviewing.
              </p>
            ) : (
              <Dialog
                open={naOpen}
                onOpenChange={(open) => {
                  setNaOpen(open)
                  if (open) setNaOpenedAt(Date.now())
                }}
              >
                <DialogTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={pending !== null}
                    className="w-full gap-1.5 text-amber-700"
                  >
                    <AlertTriangle className="h-4 w-4" />
                    Can&rsquo;t get in? File a no-access report
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
                  <DialogHeader>
                    <DialogTitle>No-access report</DialogTitle>
                  </DialogHeader>
                  <p className="text-xs text-muted-foreground">
                    To qualify for the aborted-visit payment you must wait{' '}
                    <strong>30 minutes</strong> on site and log at least{' '}
                    <strong>2 contact attempts</strong>. You&rsquo;ve been
                    checked in for <strong>{waitedMinutes} min</strong>.
                  </p>
                  {(waitedMinutes < 30 || attempts.length < 2) && (
                    <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                      {waitedMinutes < 30
                        ? `Only ${waitedMinutes} min on site so far. `
                        : ''}
                      {attempts.length < 2
                        ? `${attempts.length}/2 contact attempts logged. `
                        : ''}
                      You can still file now, but the report may not qualify.
                    </p>
                  )}
                  <div className="space-y-1.5">
                    <Label className="text-xs">What&rsquo;s the problem?</Label>
                    <Select value={naReason} onValueChange={setNaReason}>
                      <SelectTrigger>
                        <SelectValue placeholder="Pick a reason" />
                      </SelectTrigger>
                      <SelectContent>
                        {NO_ACCESS_REASONS.map((r) => (
                          <SelectItem key={r.value} value={r.value}>
                            {r.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">
                      Contact attempts ({attempts.length} logged)
                    </Label>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="gap-1"
                        onClick={() =>
                          setAttempts((a) => [
                            ...a,
                            { at: new Date().toISOString(), method: 'call' },
                          ])
                        }
                      >
                        <PhoneCall className="h-3.5 w-3.5" />I called
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setAttempts((a) => [
                            ...a,
                            { at: new Date().toISOString(), method: 'message' },
                          ])
                        }
                      >
                        I messaged
                      </Button>
                    </div>
                    {attempts.length > 0 && (
                      <p className="text-[11px] text-muted-foreground">
                        {attempts
                          .map((a) => `${a.method} at ${fmtTime(a.at)}`)
                          .join(' · ')}
                      </p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">
                      Photos of the access point (door, lockbox…)
                    </Label>
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      multiple
                      className="block w-full text-xs"
                      onChange={(e) =>
                        setNaPhotos(Array.from(e.target.files ?? []).slice(0, 10))
                      }
                    />
                    {naPhotos.length > 0 && (
                      <p className="text-[11px] text-muted-foreground">
                        {naPhotos.length} photo{naPhotos.length > 1 ? 's' : ''}{' '}
                        attached
                      </p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">What happened?</Label>
                    <Textarea
                      value={naNote}
                      onChange={(e) => setNaNote(e.target.value)}
                      rows={3}
                      className="text-sm"
                      placeholder="Lockbox code doesn't open the box; called the agent twice, no answer."
                    />
                  </div>
                  <Button
                    type="button"
                    onClick={handleNoAccess}
                    disabled={pending !== null || !naReason}
                    className="w-full gap-1.5"
                  >
                    {pending === 'no_access' && (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    )}
                    File report
                  </Button>
                </DialogContent>
              </Dialog>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
