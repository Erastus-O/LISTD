import { CalendarPlus, Download } from 'lucide-react'

/**
 * Shared "Add to calendar" affordance for the desktop client + clerk
 * job detail pages.
 *
 * Two adjacent buttons: a Google deep-link (one-tap, opens
 * calendar.google.com pre-filled) and an .ics download (universal —
 * Apple / Outlook / Fastmail / any other client). Both URLs come from
 * the parent page so this component stays a pure render layer.
 *
 * Server component — no client state, no hydration. The links and
 * `<a>` semantics handle the click flow entirely.
 *
 * Returns null when `googleUrl` is empty, which is how callers signal
 * "this job has no schedule yet". Avoids rendering a dead button.
 */
export function AddToCalendarButtons({
  googleUrl,
  icsUrl,
  filenameLabel,
}: {
  googleUrl: string | null
  icsUrl: string
  /** Filename suffix the browser shows on download (the route also
   *  sets `content-disposition`, but some browsers honour the link's
   *  download attribute over the header). */
  filenameLabel: string
}) {
  if (!googleUrl) return null
  return (
    <div className="flex flex-wrap items-center gap-2">
      <a
        href={googleUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex h-9 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm font-medium shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground"
      >
        <CalendarPlus className="h-4 w-4" />
        Add to Google Calendar
      </a>
      <a
        href={icsUrl}
        download={`${filenameLabel}.ics`}
        className="inline-flex h-9 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm font-medium shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground"
      >
        <Download className="h-4 w-4" />
        Download .ics
      </a>
    </div>
  )
}
