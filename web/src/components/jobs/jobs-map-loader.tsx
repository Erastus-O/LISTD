'use client'

import dynamic from 'next/dynamic'
import type { ComponentType } from 'react'
import type { MapPin } from './jobs-map'

type Props = { pins: MapPin[]; emptyLabel?: string }

/**
 * Client-side dynamic import of the Leaflet map. Leaflet calls `window`
 * during module evaluation, which crashes on SSR — wrapping it in
 * `dynamic(..., { ssr: false })` defers the import until hydration and
 * shows a lightweight skeleton in the meantime. Server pages import
 * this loader, not the map component itself.
 */
const JobsMap = dynamic(
  () => import('./jobs-map').then((m) => m.default),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[60vh] min-h-[400px] w-full items-center justify-center rounded-xl border border-border bg-muted/20 text-sm text-muted-foreground">
        Loading map…
      </div>
    ),
  }
) as ComponentType<Props>

export function JobsMapLoader(props: Props) {
  return <JobsMap {...props} />
}
