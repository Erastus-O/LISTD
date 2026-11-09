'use client'

import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

/** Give up on a navigation that never lands (offline, aborted) after this. */
const SAFETY_TIMEOUT_MS = 15_000

type Phase = 'idle' | 'loading' | 'finishing'

const SCALE: Record<Phase, number> = { idle: 0, loading: 0.85, finishing: 1 }

const TRANSITION: Record<Phase, string> = {
  idle: 'none',
  // Long ease-out so the bar keeps creeping without ever reaching the end.
  loading: 'transform 8s cubic-bezier(0.1, 0.7, 0.2, 1), opacity 0.15s',
  finishing: 'transform 0.2s ease-out, opacity 0.3s ease 0.15s',
}

/**
 * Thin progress bar pinned to the top of the viewport during route changes.
 *
 * `loading.tsx` only paints once the server starts streaming, so on a cold
 * dynamic route a click can look like it did nothing for a moment. This bar
 * starts on the click itself and completes when the pathname changes.
 *
 * Detection is a document-level click listener: it runs after React's own
 * handlers, so a `<Link>` navigation has already called `preventDefault()`
 * by the time we see it. Query-only and hash-only changes are skipped (they
 * keep the same pathname, so there'd be no signal to finish on).
 */
export function NavigationProgress() {
  const pathname = usePathname()
  const [phase, setPhase] = useState<Phase>('idle')
  const loadingRef = useRef(false)
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return
      }
      const anchor = (event.target as Element | null)?.closest?.('a[href]')
      if (!(anchor instanceof HTMLAnchorElement)) return
      if (anchor.target && anchor.target !== '_self') return
      if (anchor.hasAttribute('download')) return

      const url = new URL(anchor.href, window.location.href)
      if (url.origin !== window.location.origin) return
      if (url.pathname === window.location.pathname) return

      loadingRef.current = true
      setPhase('loading')
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => {
        loadingRef.current = false
        setPhase('idle')
      }, SAFETY_TIMEOUT_MS)
    }

    document.addEventListener('click', onClick)
    return () => {
      document.removeEventListener('click', onClick)
      window.clearTimeout(timer.current)
    }
  }, [])

  // The new route has rendered: run the bar to 100% and fade it out.
  useEffect(() => {
    if (!loadingRef.current) return
    loadingRef.current = false
    setPhase('finishing')
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setPhase('idle'), 500)
  }, [pathname])

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-x-0 top-0 z-9999 h-0.75"
    >
      <div
        className="h-full origin-left bg-linear-to-r from-(--teal-500) via-(--mint-500) to-(--teal-500)"
        style={{
          transform: `scaleX(${SCALE[phase]})`,
          opacity: phase === 'idle' ? 0 : 1,
          transition: TRANSITION[phase],
        }}
      />
    </div>
  )
}
