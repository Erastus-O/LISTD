import { Skeleton } from '@/components/ui/skeleton'

/**
 * Route-level loading UI, rendered by the `loading.tsx` files.
 *
 * `loading.tsx` wraps a segment's pages in a Suspense boundary but never its
 * own layout, so these render *inside* the role shell — sidebar and top bar
 * stay put while the page's server data streams in.
 */

/** Accessible label shared by every variant. */
function LoadingLabel() {
  return <span className="sr-only">Loading…</span>
}

/**
 * Dashboard-style skeleton for pages inside `RoleLayoutShell`: title, a KPI
 * row and a table-ish panel. Padding matches the pages' own
 * `w-full space-y-6 px-6 py-10` wrapper so content doesn't jump on swap-in.
 */
export function DashboardPageLoading() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="w-full space-y-6 px-6 py-10"
    >
      <LoadingLabel />
      <div className="space-y-2">
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-3 w-36" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="space-y-3 rounded-xl border bg-card p-5">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-7 w-16" />
          </div>
        ))}
      </div>

      <div className="rounded-xl border bg-card">
        <div className="border-b p-4">
          <Skeleton className="h-4 w-40" />
        </div>
        <div className="divide-y">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-3">
              <Skeleton className="h-4 w-1/4" />
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="ml-auto h-4 w-16" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/** Narrow content skeleton for the tenant portal's `max-w-3xl` column. */
export function PortalPageLoading() {
  return (
    <div role="status" aria-live="polite" className="space-y-4">
      <LoadingLabel />
      <Skeleton className="h-8 w-48" />
      <div className="space-y-3 rounded-xl border bg-card p-5">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-4 w-2/3" />
      </div>
      <div className="space-y-3 rounded-xl border bg-card p-5">
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-24 w-full" />
      </div>
    </div>
  )
}

/**
 * Centred spinner for whole-screen waits — the root boundary (covers the
 * first hop into a role section while its layout runs the auth check) and
 * chrome-less surfaces like marketing and inspection capture.
 */
export function FullPageLoading() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-[60vh] flex-1 flex-col items-center justify-center gap-4"
    >
      <LoadingLabel />
      <div className="relative h-14 w-14" aria-hidden>
        <span className="absolute inset-0 animate-spin rounded-full border-2 border-primary/15 border-t-primary" />
        <span className="absolute inset-2.5 animate-spin rounded-full border-2 border-transparent border-b-accent [animation-direction:reverse] [animation-duration:1.4s]" />
      </div>
      <span
        className="animate-pulse text-[10px] font-semibold uppercase tracking-[0.24em] text-muted-foreground"
        aria-hidden
      >
        Loading
      </span>
    </div>
  )
}
