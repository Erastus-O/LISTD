'use client'

import { useEffect, useMemo, useRef } from 'react'
import Link from 'next/link'
import L, { type LatLngBoundsExpression } from 'leaflet'
import {
  MapContainer,
  Marker,
  Popup,
  TileLayer,
  useMap,
} from 'react-leaflet'
import MarkerClusterGroup from 'react-leaflet-cluster'
import 'leaflet/dist/leaflet.css'
import 'leaflet.markercluster/dist/MarkerCluster.css'
import 'leaflet.markercluster/dist/MarkerCluster.Default.css'

export type MapPin = {
  id: string
  lat: number
  lng: number
  /** Top line of the popup (bold). e.g. "New Inventory · BS1-70254FD9" */
  title: string
  /** Optional secondary line, e.g. property address or postcode area. */
  subtitle?: string
  /** Optional tertiary line, e.g. "£82.00 · Sat 30 May 2026". */
  meta?: string
  /** Destination of the popup's "View" link. */
  href: string
  /** Optional secondary action rendered as a small link below "View".
   *  Use case: "Filter to BS1" — clicking flips back to list view with
   *  the relevant URL filter applied. */
  secondaryAction?: { label: string; href: string }
}

type Props = {
  pins: MapPin[]
  /** Label rendered when there are no plottable pins (e.g. "No matching
   *  jobs in mappable postcodes"). */
  emptyLabel?: string
}

/** LISTD brand teal — kept in sync with TEAL in render-pdf.ts and the
 *  Tailwind theme. */
const TEAL = '#2EC4B6'

/**
 * Lucide `map-pin` rendered as an inline SVG, stroked + filled in brand
 * teal. Using `L.divIcon` rather than `L.icon` means we don't ship a
 * separate raster asset and the colour can change at runtime via CSS.
 */
const PIN_ICON = L.divIcon({
  className: '', // suppress Leaflet's default `.leaflet-div-icon` border
  iconSize: [28, 28],
  iconAnchor: [14, 28], // tip of the pin
  popupAnchor: [0, -26],
  html: `
    <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24"
         fill="${TEAL}" stroke="#ffffff" stroke-width="1.5"
         stroke-linecap="round" stroke-linejoin="round"
         style="filter: drop-shadow(0 2px 3px rgba(15,23,42,0.35));">
      <path d="M20 10c0 7-8 13-8 13s-8-6-8-13a8 8 0 0 1 16 0Z"/>
      <circle cx="12" cy="10" r="3" fill="#ffffff" stroke="${TEAL}" stroke-width="1.5"/>
    </svg>
  `,
})

/**
 * Cluster bubble — small teal disc with the count. We render via
 * `iconCreateFunction` so the cluster styling matches the pin colour
 * rather than the leaflet.markercluster defaults (blue/yellow/red).
 * Size grows in three steps so 2 vs 50 vs 500 pins read distinctly.
 */
function makeClusterIcon(cluster: { getChildCount(): number }) {
  const count = cluster.getChildCount()
  const size = count < 10 ? 32 : count < 50 ? 38 : 44
  return L.divIcon({
    className: '',
    iconSize: [size, size],
    html: `
      <div style="
        width: ${size}px; height: ${size}px;
        display: flex; align-items: center; justify-content: center;
        background: ${TEAL}; color: #fff;
        border: 2px solid #fff;
        border-radius: 9999px;
        font: 600 ${count > 99 ? '11' : '13'}px ui-sans-serif, system-ui;
        box-shadow: 0 2px 6px rgba(15,23,42,0.35);
      ">${count}</div>
    `,
  })
}

/**
 * Leaflet map of job locations. Pins cluster when zoomed out so dense
 * city centres stay readable; clicking a cluster zooms in to expand it.
 * The list page passes a flat list of pins (one per geocoded job); we
 * fit the bounding box on mount, or fall back to a UK-wide view when
 * the list is empty.
 *
 * Loaded via `next/dynamic` with `ssr: false` from the page server
 * component — Leaflet calls `window` during import so it can't render
 * during SSR.
 */
export default function JobsMap({ pins, emptyLabel }: Props) {
  const bounds = useMemo<LatLngBoundsExpression | null>(() => {
    if (pins.length <= 1) return null
    return pins.map((p) => [p.lat, p.lng])
  }, [pins])

  // Empty state — render a static UK-wide map placeholder rather than
  // an unbounded blank canvas so the user understands the view loaded.
  if (pins.length === 0) {
    return (
      <div className="relative h-[60vh] min-h-[400px] w-full overflow-hidden rounded-xl border border-border">
        <MapContainer
          center={[54.5, -3]}
          zoom={5}
          scrollWheelZoom
          className="h-full w-full"
        >
          <BaseTiles />
        </MapContainer>
        <div className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-sm text-muted-foreground">
          <span className="rounded-md bg-background/90 px-3 py-1.5 shadow-sm">
            {emptyLabel ?? 'No mappable jobs in this view.'}
          </span>
        </div>
      </div>
    )
  }

  const center: [number, number] = [pins[0]!.lat, pins[0]!.lng]

  return (
    <div className="h-[60vh] min-h-[400px] w-full overflow-hidden rounded-xl border border-border">
      <MapContainer
        center={center}
        zoom={pins.length === 1 ? 13 : 6}
        scrollWheelZoom
        className="h-full w-full"
      >
        <BaseTiles />
        {bounds && <FitBounds bounds={bounds} />}
        <MarkerClusterGroup
          chunkedLoading
          showCoverageOnHover={false}
          spiderfyOnMaxZoom
          iconCreateFunction={makeClusterIcon}
        >
          {pins.map((p) => (
            <Marker key={p.id} position={[p.lat, p.lng]} icon={PIN_ICON}>
              <Popup>
                <div className="space-y-1 text-xs">
                  <p className="font-semibold text-foreground">{p.title}</p>
                  {p.subtitle && (
                    <p className="text-muted-foreground">{p.subtitle}</p>
                  )}
                  {p.meta && (
                    <p className="text-[11px] text-muted-foreground">
                      {p.meta}
                    </p>
                  )}
                  <div className="mt-1 flex flex-wrap items-center gap-3">
                    <Link
                      href={p.href}
                      className="font-medium text-primary hover:underline"
                    >
                      View →
                    </Link>
                    {p.secondaryAction && (
                      <Link
                        href={p.secondaryAction.href}
                        className="text-[11px] font-medium text-muted-foreground hover:text-foreground hover:underline"
                      >
                        {p.secondaryAction.label}
                      </Link>
                    )}
                  </div>
                </div>
              </Popup>
            </Marker>
          ))}
        </MarkerClusterGroup>
      </MapContainer>
    </div>
  )
}

function BaseTiles() {
  return (
    <TileLayer
      attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
      url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
    />
  )
}

/**
 * Fits the map to the supplied bounds after mount. Lives inside
 * `MapContainer` so it can access the map via `useMap()`.
 */
function FitBounds({ bounds }: { bounds: LatLngBoundsExpression }) {
  const map = useMap()
  const ref = useRef<LatLngBoundsExpression | null>(null)
  useEffect(() => {
    if (ref.current === bounds) return
    ref.current = bounds
    map.fitBounds(bounds, { padding: [40, 40] })
  }, [bounds, map])
  return null
}
