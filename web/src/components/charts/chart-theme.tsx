'use client'

import { useId, useMemo, type ReactNode } from 'react'

/**
 * Shared chart theming primitives. Used across the admin / client / worker
 * dashboards so every chart in the app speaks the same visual language.
 *
 * Design tokens here intentionally use plain HSL strings rather than CSS
 * variables — recharts caches SVG fills at mount and doesn't always pick
 * up theme-token changes mid-render. Keeping the literal values here is
 * the simplest way to guarantee consistent visuals across charts.
 */

/**
 * Curated palette derived from the LISTD brand. First color is primary
 * teal (#2EC4B6); accent peach sits at index 3 to break up consecutive
 * cool tones in a stacked chart. Order is hand-tuned for visual rhythm,
 * not data-viz best practice — for accessibility-critical surfaces use
 * `CHART_COLORS_QUALITATIVE` which is a categorical-safe alternative.
 */
export const CHART_COLORS = [
  '#2EC4B6', // teal (brand primary)
  '#5BB7F8', // sky
  '#9B6DD8', // purple
  '#FFBF69', // peach (brand accent)
  '#22C55E', // emerald
  '#F472B6', // pink
  '#FBBF24', // amber
  '#94A3B8', // slate (neutral filler)
] as const

/**
 * Categorical-safe palette — works in colour-blind situations and for
 * stacked charts where adjacent colours must remain distinguishable.
 * Drop-in replacement when a chart's accessibility matters more than its
 * on-brand rhythm.
 */
export const CHART_COLORS_QUALITATIVE = [
  '#1F77B4',
  '#FF7F0E',
  '#2CA02C',
  '#D62728',
  '#9467BD',
  '#8C564B',
  '#E377C2',
  '#7F7F7F',
] as const

export const CHART_NEUTRAL_OTHER = '#CBD5E1' // slate-300

/**
 * Axis styling tokens. Lighter grid + smaller tick text reads cleaner
 * than recharts' defaults. Tick padding is for breathing room between
 * labels and the chart area.
 */
export const CHART_AXIS = {
  tick: { fontSize: 11, fill: '#64748B' },
  tickLine: false as const,
  axisLine: false as const,
  tickMargin: 8,
}

export const CHART_GRID = {
  stroke: '#E2E8F0',
  strokeDasharray: '3 6',
  vertical: false,
}

/**
 * Per-chart gradient + filter definitions. Uses `useId()` so each chart
 * instance gets a unique prefix on every SVG `id` it inlines.
 *
 * **Why unique IDs.** When multiple charts on the same page share static
 * gradient ids (`grad-bar-0`, etc.), browsers resolve `fill="url(#grad-bar-0)"`
 * **document-scoped** rather than per-SVG. Some layout configurations
 * (flex / transform / late-mount) cause Chromium to bind the reference
 * to a gradient that's been replaced or hasn't computed its bounding
 * box yet — bars then paint as transparent/black. Per-instance ids
 * sidestep the issue entirely.
 *
 * Usage:
 *
 *     const { defs, gradFor } = useChartGradients()
 *     <BarChart>
 *       {defs}
 *       <Bar fill={gradFor(0, 'bar')} />
 *     </BarChart>
 */
export function useChartGradients(): {
  defs: ReactNode
  gradFor: (i: number, kind?: 'area' | 'bar') => string
  otherBarGradient: string
  shadowFilter: string
} {
  // `useId()` returns something like `:r3:` — strip the colons since
  // they're SVG-attribute-legal but make funcIRI lookups brittle in
  // some renderers.
  const rawId = useId()
  const prefix = useMemo(
    () => `c${rawId.replace(/[^a-zA-Z0-9_-]/g, '')}`,
    [rawId]
  )
  const defs = useMemo(
    () => (
      <defs>
        {CHART_COLORS.map((color, i) => (
          <linearGradient
            key={`grad-area-${i}`}
            id={`${prefix}-grad-area-${i}`}
            x1="0"
            y1="0"
            x2="0"
            y2="1"
          >
            <stop offset="0%" stopColor={color} stopOpacity={0.32} />
            <stop offset="100%" stopColor={color} stopOpacity={0.02} />
          </linearGradient>
        ))}
        {CHART_COLORS.map((color, i) => (
          <linearGradient
            key={`grad-bar-${i}`}
            id={`${prefix}-grad-bar-${i}`}
            x1="0"
            y1="0"
            x2="0"
            y2="1"
          >
            <stop offset="0%" stopColor={color} stopOpacity={1} />
            <stop offset="100%" stopColor={color} stopOpacity={0.85} />
          </linearGradient>
        ))}
        <linearGradient
          id={`${prefix}-grad-bar-other`}
          x1="0"
          y1="0"
          x2="0"
          y2="1"
        >
          <stop offset="0%" stopColor={CHART_NEUTRAL_OTHER} stopOpacity={0.95} />
          <stop offset="100%" stopColor={CHART_NEUTRAL_OTHER} stopOpacity={0.75} />
        </linearGradient>
        <filter
          id={`${prefix}-chart-bar-shadow`}
          x="-20%"
          y="-20%"
          width="140%"
          height="140%"
        >
          <feDropShadow
            dx="0"
            dy="1"
            stdDeviation="1"
            floodColor="#0F172A"
            floodOpacity="0.06"
          />
        </filter>
      </defs>
    ),
    [prefix]
  )

  return {
    defs,
    gradFor: (i, kind = 'bar') =>
      `url(#${prefix}-grad-${kind}-${i % CHART_COLORS.length})`,
    otherBarGradient: `url(#${prefix}-grad-bar-other)`,
    shadowFilter: `url(#${prefix}-chart-bar-shadow)`,
  }
}

/**
 * Helper to derive a deterministic colour for a series key (worker id,
 * status name, etc) so the same key always gets the same colour across
 * tooltips, legends and bars.
 */
export function colorForIndex(i: number): string {
  return CHART_COLORS[i % CHART_COLORS.length]!
}

/**
 * Custom recharts tooltip. Replaces the default cream rectangle with a
 * polished card. Numbers default to en-GB locale; pass a `formatter`
 * for unit-specific renders (currency, percentages, etc).
 */
/** Recharts payload entries are loosely typed (`ValueType | NameType`
 *  generics) — widen our shape to `unknown` so the recharts `content`
 *  prop accepts our component without a structural mismatch. */
export type ChartTooltipPayload = {
  name?: unknown
  value?: unknown
  color?: string
  dataKey?: string | number
  payload?: Record<string, unknown>
}

export type ChartTooltipProps = {
  active?: boolean
  label?: unknown
  payload?: ChartTooltipPayload[]
  /** Override the rendered label (e.g. resolve worker name from id). */
  formatLabel?: (label: unknown) => string | ReactNode
  /** Format a value before display. */
  formatValue?: (
    value: number,
    name: string | undefined,
    payload: ChartTooltipPayload
  ) => string
  /** Override the rendered series name. */
  formatName?: (name: string | undefined) => string
  /** Hide the colour swatch (useful for single-series charts). */
  hideSwatch?: boolean
}

export function ChartTooltip({
  active,
  label,
  payload,
  formatLabel,
  formatValue,
  formatName,
  hideSwatch,
}: ChartTooltipProps) {
  if (!active || !payload || payload.length === 0) return null
  const visible = payload.filter(
    (p) =>
      p.value !== undefined && p.value !== null && Number(p.value) !== 0
  )
  if (visible.length === 0) return null
  const renderedLabel = formatLabel
    ? formatLabel(label)
    : typeof label === 'string' || typeof label === 'number'
      ? String(label)
      : ''
  return (
    <div className="rounded-lg border border-border bg-popover/95 px-3 py-2 text-popover-foreground shadow-md backdrop-blur-sm">
      {renderedLabel !== '' && (
        <p className="mb-1 text-[11px] font-medium text-foreground">
          {renderedLabel}
        </p>
      )}
      <ul className="space-y-0.5">
        {visible.map((p, i) => {
          const rawName =
            typeof p.name === 'string'
              ? p.name
              : p.name !== undefined && p.name !== null
                ? String(p.name)
                : undefined
          const seriesName =
            (formatName ? formatName(rawName) : rawName) ?? p.dataKey ?? ''
          const numericValue = Number(p.value)
          const isNumeric = Number.isFinite(numericValue)
          const valueText = isNumeric
            ? formatValue
              ? formatValue(numericValue, rawName, p)
              : numericValue.toLocaleString('en-GB')
            : String(p.value)
          return (
            <li
              key={i}
              className="flex items-center justify-between gap-3 text-[11px]"
            >
              <span className="flex items-center gap-1.5 text-muted-foreground">
                {!hideSwatch && p.color && (
                  <span
                    className="h-2 w-2 shrink-0 rounded-sm"
                    style={{ background: p.color }}
                  />
                )}
                {seriesName}
              </span>
              <span className="font-medium text-foreground">{valueText}</span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/**
 * Format £ with compact suffix for axis ticks (£1.2k / £15k).
 */
export function compactCurrency(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `£${(v / 1_000_000).toFixed(1)}m`
  if (Math.abs(v) >= 1000) return `£${(v / 1000).toFixed(1)}k`
  return `£${v.toFixed(0)}`
}

/**
 * Common empty-state for charts. Keeps the pattern unified instead of
 * each chart re-rolling their own.
 */
export function ChartEmpty({ note }: { note?: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1 text-center">
      <div className="h-12 w-12 rounded-full bg-muted/60" />
      <p className="text-xs text-muted-foreground">{note ?? 'No data yet'}</p>
    </div>
  )
}
