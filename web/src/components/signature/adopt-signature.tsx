'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Eraser, PenLine, Type } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Adopt-a-signature panel, DocuSign's model.
 *
 * The signer's typed name stays the identity check — that's unchanged and
 * it's what the sign endpoints match against the name on file. What this
 * adds is the **mark**: either their name set in a handwriting face, or
 * one drawn with a finger or mouse. Both produce a transparent PNG, so
 * everything downstream (storage, the PDF signature page) handles one
 * format and never needs a handwriting font server-side.
 *
 * The Style tab is the accessible default: it works on a desktop with no
 * touchscreen, and a name typed once produces a legible mark. Draw is
 * there because a drawn mark is what most people picture when they think
 * of signing, and on a phone it's the natural gesture.
 */

export type AdoptedSignature = {
  /** Transparent PNG data URL of the mark. */
  dataUrl: string
  mode: 'styled' | 'drawn'
}

type Props = {
  /** The signer's typed name — drives the Style previews. */
  fullName: string
  value: AdoptedSignature | null
  onChange: (value: AdoptedSignature | null) => void
  disabled?: boolean
}

/** The three faces from `public/fonts` (SIL OFL). `cursive` is the last
 *  resort so the tab still renders something if a file 404s. */
const STYLES = [
  { id: 'caveat', label: 'Caveat', css: '"LISTD Signature Caveat", cursive', weight: 600 },
  { id: 'dancing', label: 'Dancing', css: '"LISTD Signature Dancing", cursive', weight: 600 },
  { id: 'sacramento', label: 'Sacramento', css: '"LISTD Signature Sacramento", cursive', weight: 400 },
] as const

/** Drawn at 3× and scaled down, so the mark stays crisp in a PDF that may
 *  be printed rather than viewed. */
const SCALE = 3
const PAD_W = 460
const PAD_H = 150

export function AdoptSignature({ fullName, value, onChange, disabled }: Props) {
  const [tab, setTab] = useState<'styled' | 'drawn'>('styled')
  const [styleId, setStyleId] = useState<(typeof STYLES)[number]['id']>('caveat')
  // A browser with no Font Loading API starts "ready": there's nothing to
  // wait for, and the canvas will paint in whatever `cursive` resolves to.
  // Only gates the canvas painting effect, never the markup, so the
  // server/client difference can't cause a hydration mismatch.
  const [fontsReady, setFontsReady] = useState(
    () => typeof document === 'undefined' || !('fonts' in document)
  )
  const [hasInk, setHasInk] = useState(false)

  const drawRef = useRef<HTMLCanvasElement | null>(null)
  const drawingRef = useRef(false)
  const lastRef = useRef<{ x: number; y: number } | null>(null)

  const trimmedName = fullName.trim()

  // Wait for the faces before painting the Style tab to a canvas —
  // `fillText` with an unloaded font silently falls back, which would
  // bake the WRONG face into the stored PNG.
  useEffect(() => {
    let cancelled = false
    if (typeof document === 'undefined' || !('fonts' in document)) return
    void Promise.all(
      STYLES.map((s) =>
        document.fonts.load(`${s.weight} 64px ${s.css.split(',')[0]}`)
      )
    )
      .catch(() => undefined)
      .then(() => {
        if (!cancelled) setFontsReady(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  /** Paint `trimmedName` in the chosen face and hand back a PNG. */
  const renderStyled = useCallback(
    (id: (typeof STYLES)[number]['id']): string | null => {
      if (!trimmedName) return null
      const style = STYLES.find((s) => s.id === id) ?? STYLES[0]
      const canvas = document.createElement('canvas')
      canvas.width = PAD_W * SCALE
      canvas.height = PAD_H * SCALE
      const ctx = canvas.getContext('2d')
      if (!ctx) return null
      ctx.scale(SCALE, SCALE)
      ctx.fillStyle = '#0f172a'
      ctx.textBaseline = 'middle'
      ctx.textAlign = 'center'

      // Shrink to fit rather than clip — some names are long, and a
      // signature with the surname cut off is worse than a small one.
      let size = 64
      ctx.font = `${style.weight} ${size}px ${style.css}`
      while (ctx.measureText(trimmedName).width > PAD_W - 32 && size > 18) {
        size -= 2
        ctx.font = `${style.weight} ${size}px ${style.css}`
      }
      ctx.fillText(trimmedName, PAD_W / 2, PAD_H / 2)
      return canvas.toDataURL('image/png')
    },
    [trimmedName]
  )

  // Keep the adopted mark in step with the name and the chosen face while
  // the Style tab is active.
  useEffect(() => {
    if (tab !== 'styled' || !fontsReady) return
    const dataUrl = renderStyled(styleId)
    onChange(dataUrl ? { dataUrl, mode: 'styled' } : null)
    // `onChange` is a parent callback; depending on it would loop when the
    // parent re-creates it each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, styleId, trimmedName, fontsReady, renderStyled])

  // ── Draw pad ──────────────────────────────────────────────────────
  const setupPad = useCallback(() => {
    const canvas = drawRef.current
    if (!canvas) return
    canvas.width = PAD_W * SCALE
    canvas.height = PAD_H * SCALE
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.scale(SCALE, SCALE)
    ctx.lineWidth = 2.4
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#0f172a'
  }, [])

  useEffect(() => {
    if (tab === 'drawn') setupPad()
  }, [tab, setupPad])

  function pointFor(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    // The canvas is CSS-scaled to its container, so map client pixels
    // back onto the pad's own coordinate space.
    return {
      x: ((e.clientX - rect.left) / rect.width) * PAD_W,
      y: ((e.clientY - rect.top) / rect.height) * PAD_H,
    }
  }

  function startStroke(e: React.PointerEvent<HTMLCanvasElement>) {
    if (disabled) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drawingRef.current = true
    lastRef.current = pointFor(e)
  }

  function moveStroke(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current || disabled) return
    const ctx = drawRef.current?.getContext('2d')
    const last = lastRef.current
    if (!ctx || !last) return
    const next = pointFor(e)
    ctx.beginPath()
    ctx.moveTo(last.x, last.y)
    ctx.lineTo(next.x, next.y)
    ctx.stroke()
    lastRef.current = next
    if (!hasInk) setHasInk(true)
  }

  function endStroke() {
    if (!drawingRef.current) return
    drawingRef.current = false
    lastRef.current = null
    const canvas = drawRef.current
    if (!canvas || !hasInk) return
    onChange({ dataUrl: canvas.toDataURL('image/png'), mode: 'drawn' })
  }

  function clearPad() {
    const canvas = drawRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    ctx.clearRect(0, 0, PAD_W, PAD_H)
    setHasInk(false)
    onChange(null)
  }

  return (
    <div className="rounded-lg border border-border bg-card">
      {/* Tabs */}
      <div className="flex border-b border-border" role="tablist">
        <TabButton
          active={tab === 'styled'}
          disabled={disabled}
          onClick={() => {
            setTab('styled')
          }}
          icon={<Type className="h-3.5 w-3.5" />}
          label="Style"
        />
        <TabButton
          active={tab === 'drawn'}
          disabled={disabled}
          onClick={() => {
            setTab('drawn')
            onChange(hasInk && drawRef.current
              ? { dataUrl: drawRef.current.toDataURL('image/png'), mode: 'drawn' }
              : null)
          }}
          icon={<PenLine className="h-3.5 w-3.5" />}
          label="Draw"
        />
      </div>

      <div className="p-3">
        {tab === 'styled' ? (
          !trimmedName ? (
            <p className="py-6 text-center text-xs text-muted-foreground">
              Type your full name above to see your signature.
            </p>
          ) : (
            <div className="space-y-2" role="radiogroup" aria-label="Signature style">
              {STYLES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  role="radio"
                  aria-checked={styleId === s.id}
                  disabled={disabled}
                  onClick={() => setStyleId(s.id)}
                  className={cn(
                    'flex w-full items-center justify-between rounded-md border px-4 py-2 text-left transition-colors',
                    styleId === s.id
                      ? 'border-primary bg-primary/5 ring-1 ring-primary/20'
                      : 'border-border hover:border-primary/40'
                  )}
                >
                  <span
                    className="truncate text-2xl leading-tight text-foreground"
                    style={{ fontFamily: s.css, fontWeight: s.weight }}
                  >
                    {trimmedName}
                  </span>
                  <span
                    className={cn(
                      'ml-3 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2',
                      styleId === s.id
                        ? 'border-primary bg-primary'
                        : 'border-muted-foreground/30'
                    )}
                  >
                    {styleId === s.id && (
                      <span className="h-1.5 w-1.5 rounded-full bg-primary-foreground" />
                    )}
                  </span>
                </button>
              ))}
            </div>
          )
        ) : (
          <div className="space-y-2">
            <canvas
              ref={drawRef}
              onPointerDown={startStroke}
              onPointerMove={moveStroke}
              onPointerUp={endStroke}
              onPointerLeave={endStroke}
              onPointerCancel={endStroke}
              style={{ aspectRatio: `${PAD_W} / ${PAD_H}`, touchAction: 'none' }}
              className={cn(
                'w-full rounded-md border border-dashed border-border bg-background',
                disabled ? 'opacity-60' : 'cursor-crosshair'
              )}
            />
            <div className="flex items-center justify-between">
              <p className="text-[11px] text-muted-foreground">
                {hasInk ? 'Looks good?' : 'Sign inside the box using your finger or mouse.'}
              </p>
              <button
                type="button"
                onClick={clearPad}
                disabled={disabled || !hasInk}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-destructive disabled:opacity-40"
              >
                <Eraser className="h-3 w-3" />
                Clear
              </button>
            </div>
          </div>
        )}

        <p className="mt-3 border-t border-border pt-2 text-[10px] leading-relaxed text-muted-foreground">
          By adopting a signature you agree it is the electronic
          representation of your signature, and that it carries the same
          effect as a pen-and-paper one on this document.
        </p>
      </div>

      {/* Screen-reader confirmation that a mark exists. */}
      <span className="sr-only" aria-live="polite">
        {value ? 'Signature adopted.' : 'No signature adopted yet.'}
      </span>
    </div>
  )
}

function TabButton({
  active,
  disabled,
  onClick,
  icon,
  label,
}: {
  active: boolean
  disabled?: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex flex-1 items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors',
        active
          ? 'border-b-2 border-primary text-foreground'
          : 'border-b-2 border-transparent text-muted-foreground hover:text-foreground'
      )}
    >
      {icon}
      {label}
    </button>
  )
}
