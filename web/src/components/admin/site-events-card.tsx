import 'server-only'
import { asc, eq } from 'drizzle-orm'
import { AlertTriangle, Clock, MapPin } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { jobSiteEvents, withServiceRole } from '@/db'
import { getSupabaseAdmin } from '@/lib/supabase/admin'

const REASON_LABELS: Record<string, string> = {
  no_keys: 'Keys not where stated',
  keyholder_absent: 'Keyholder absent',
  wrong_address: 'Wrong address supplied',
  wrong_access_code: 'Access code wrong',
  property_unsafe: 'Property unsafe',
  tenant_refused: 'Tenant refused entry',
  other: 'Other',
}

type EventRow = {
  id: string
  kind: string
  actorRole: string
  createdAt: string
  note: string | null
  etaMinutes: number | null
  reason: string | null
  waitFrom: string | null
  waitUntil: string | null
  contactAttempts: unknown
  latitude: number | null
  longitude: number | null
  accuracyM: number | null
  photoPaths: unknown
}

function fmt(iso: string): string {
  // Server renders in UTC — pin to UK wall-clock so BST times read right.
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/London',
  })
}

function waitMinutes(e: EventRow): number | null {
  if (!e.waitFrom || !e.waitUntil) return null
  const ms = new Date(e.waitUntil).getTime() - new Date(e.waitFrom).getTime()
  return Number.isFinite(ms) && ms >= 0 ? Math.round(ms / 60_000) : null
}

/**
 * Admin "Site events" card — the on-the-ground evidence trail (0038):
 * arrival check-ins (with a live map pin when geolocated), running-late
 * flags, and no-access reports with their evidence bundle. Server
 * component: loads its own rows and signs photo URLs (private bucket).
 * Renders nothing when the job has no events (or the table doesn't exist
 * yet on a pre-0038 database).
 */
export async function SiteEventsCard({ jobId }: { jobId: string }) {
  const events: EventRow[] = await withServiceRole((tx) =>
    tx
      .select({
        id: jobSiteEvents.id,
        kind: jobSiteEvents.kind,
        actorRole: jobSiteEvents.actorRole,
        createdAt: jobSiteEvents.createdAt,
        note: jobSiteEvents.note,
        etaMinutes: jobSiteEvents.etaMinutes,
        reason: jobSiteEvents.reason,
        waitFrom: jobSiteEvents.waitFrom,
        waitUntil: jobSiteEvents.waitUntil,
        contactAttempts: jobSiteEvents.contactAttempts,
        latitude: jobSiteEvents.latitude,
        longitude: jobSiteEvents.longitude,
        accuracyM: jobSiteEvents.accuracyM,
        photoPaths: jobSiteEvents.photoPaths,
      })
      .from(jobSiteEvents)
      .where(eq(jobSiteEvents.jobId, jobId))
      .orderBy(asc(jobSiteEvents.createdAt))
  ).catch(() => [] as EventRow[])

  if (events.length === 0) return null

  // Sign photo paths (private `job-photos` bucket) — 1 h TTL, page is
  // rendered per-request so links stay fresh.
  const admin = getSupabaseAdmin()
  const signed = new Map<string, string>()
  for (const e of events) {
    const paths = Array.isArray(e.photoPaths) ? (e.photoPaths as string[]) : []
    for (const p of paths) {
      if (signed.has(p)) continue
      const { data } = await admin.storage
        .from('job-photos')
        .createSignedUrl(p, 60 * 60)
      if (data?.signedUrl) signed.set(p, data.signedUrl)
    }
  }

  const arrival = events.find(
    (e) => e.kind === 'arrival' && e.latitude != null && e.longitude != null
  )

  return (
    <Card>
      <CardContent className="space-y-3 p-6">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
          <MapPin className="h-4 w-4" /> Site events ({events.length})
        </h2>

        {arrival && (
          <div className="overflow-hidden rounded-md border border-border">
            <iframe
              title="Check-in location"
              className="h-44 w-full"
              loading="lazy"
              src={`https://www.openstreetmap.org/export/embed.html?bbox=${
                (arrival.longitude as number) - 0.003
              }%2C${(arrival.latitude as number) - 0.0015}%2C${
                (arrival.longitude as number) + 0.003
              }%2C${(arrival.latitude as number) + 0.0015}&layer=mapnik&marker=${arrival.latitude}%2C${arrival.longitude}`}
            />
            <div className="flex items-center justify-between bg-muted/30 px-2.5 py-1.5 text-[11px] text-muted-foreground">
              <span>
                Checked in here at {fmt(arrival.createdAt)}
                {arrival.accuracyM != null
                  ? ` (±${Math.round(arrival.accuracyM)} m)`
                  : ''}
              </span>
              <a
                href={`https://www.google.com/maps?q=${arrival.latitude},${arrival.longitude}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-primary hover:underline"
              >
                Open in Maps
              </a>
            </div>
          </div>
        )}

        <ul className="space-y-2">
          {events.map((e) => {
            const paths = Array.isArray(e.photoPaths)
              ? (e.photoPaths as string[])
              : []
            const attempts = Array.isArray(e.contactAttempts)
              ? (e.contactAttempts as { at: string; method: string }[])
              : []
            const waited = waitMinutes(e)
            return (
              <li
                key={e.id}
                className="rounded-md border border-border bg-muted/20 p-2.5 text-xs"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 font-medium text-foreground">
                    {e.kind === 'arrival' ? (
                      <>
                        <MapPin className="h-3.5 w-3.5 text-success" />
                        Checked in
                      </>
                    ) : e.kind === 'running_late' ? (
                      <>
                        <Clock className="h-3.5 w-3.5 text-amber-600" />
                        Running late (~{e.etaMinutes} min)
                      </>
                    ) : (
                      <>
                        <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
                        No access — {REASON_LABELS[e.reason ?? ''] ?? e.reason}
                      </>
                    )}
                    <span className="font-normal text-muted-foreground">
                      · {e.actorRole}
                    </span>
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {fmt(e.createdAt)}
                  </span>
                </div>
                {e.kind === 'no_access' && (
                  <p className="mt-1 text-muted-foreground">
                    {waited != null ? `Waited ${waited} min. ` : ''}
                    {attempts.length} contact attempt
                    {attempts.length === 1 ? '' : 's'} logged
                    {attempts.length > 0
                      ? ` (${attempts.map((a) => a.method).join(', ')})`
                      : ''}
                    .
                  </p>
                )}
                {e.note && (
                  <p className="mt-1 whitespace-pre-wrap text-muted-foreground">
                    {e.note}
                  </p>
                )}
                {paths.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {paths.map((p) => {
                      const url = signed.get(p)
                      if (!url) return null
                      return (
                        <a
                          key={p}
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={url}
                            alt="Site evidence"
                            className="h-14 w-14 rounded border border-border object-cover"
                          />
                        </a>
                      )
                    })}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      </CardContent>
    </Card>
  )
}
