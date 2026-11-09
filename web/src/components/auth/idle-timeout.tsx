'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

/**
 * Idle-session guard. Signs the user out after 30 minutes with no
 * interaction, then redirects to the login page.
 *
 * Mounted once in the authenticated shell ({@link RoleLayoutShell}), so
 * it covers every session-authenticated desktop surface (admin / client
 * / clerk / worker). The tenant portal is deliberately NOT covered — it's
 * token-authenticated, not session-authenticated, so there's no Supabase
 * session to expire.
 *
 * How it stays honest across the tricky cases:
 *
 *   - **Reload / re-open** — last-activity is persisted to localStorage,
 *     so a page reload doesn't grant a fresh 30 minutes. On mount we read
 *     the stored timestamp; if the idle window already lapsed, we sign
 *     out immediately.
 *   - **Multiple tabs** — activity in any tab writes the shared
 *     localStorage key; a `storage` event reschedules the timer in every
 *     other tab. Sign-out in one tab propagates because they all read the
 *     same key.
 *   - **Backgrounded tabs** — browsers throttle `setTimeout` in hidden
 *     tabs, so the timer can fire late. We re-check actual elapsed time
 *     on every fire AND on `visibilitychange`, so a late timer still
 *     logs out at the right moment when the tab regains focus.
 *
 * Activity is throttled to one localStorage write per 5s so a burst of
 * mousemove events doesn't hammer storage.
 */

const IDLE_LIMIT_MS = 30 * 60 * 1000 // 30 minutes
const ACTIVITY_WRITE_THROTTLE_MS = 5_000
const STORAGE_KEY = 'listd:last-activity-at'

const ACTIVITY_EVENTS = [
  'mousemove',
  'mousedown',
  'keydown',
  'touchstart',
  'scroll',
  'wheel',
] as const

export function IdleTimeout() {
  const router = useRouter()
  const timerRef = useRef<number | null>(null)
  const loggingOutRef = useRef(false)

  useEffect(() => {
    const readLastActivity = (): number => {
      try {
        const raw = localStorage.getItem(STORAGE_KEY)
        const t = raw ? Number.parseInt(raw, 10) : NaN
        return Number.isFinite(t) ? t : Date.now()
      } catch {
        return Date.now()
      }
    }

    const writeLastActivity = (t: number): void => {
      try {
        localStorage.setItem(STORAGE_KEY, String(t))
      } catch {
        // Private mode / storage disabled — the in-memory timer still
        // works for this tab; cross-tab sync just won't.
      }
    }

    const logout = async (): Promise<void> => {
      if (loggingOutRef.current) return
      loggingOutRef.current = true
      try {
        await createClient().auth.signOut()
      } catch {
        // Even if signOut fails (offline), still bounce to login — the
        // middleware will re-validate and reject a stale session there.
      }
      try {
        localStorage.removeItem(STORAGE_KEY)
      } catch {
        // ignore
      }
      router.replace('/auth?timeout=1')
      router.refresh()
    }

    const schedule = (): void => {
      if (timerRef.current) window.clearTimeout(timerRef.current)
      const elapsed = Date.now() - readLastActivity()
      const remaining = IDLE_LIMIT_MS - elapsed
      if (remaining <= 0) {
        void logout()
        return
      }
      timerRef.current = window.setTimeout(() => {
        // Re-check on fire: cross-tab activity may have pushed the
        // deadline out, and background-throttled timers fire late.
        if (Date.now() - readLastActivity() >= IDLE_LIMIT_MS) {
          void logout()
        } else {
          schedule()
        }
      }, remaining)
    }

    let lastWrite = 0
    const onActivity = (): void => {
      const now = Date.now()
      if (now - lastWrite < ACTIVITY_WRITE_THROTTLE_MS) return
      lastWrite = now
      writeLastActivity(now)
      schedule()
    }

    const onVisibility = (): void => {
      // Returning to a backgrounded tab is NOT activity — but it IS a
      // moment to re-check whether the idle window lapsed while away.
      if (document.visibilityState === 'visible') schedule()
    }

    const onStorage = (e: StorageEvent): void => {
      if (e.key === STORAGE_KEY) schedule()
    }

    // Seed the timestamp on first ever load so a fresh session gets the
    // full window; don't overwrite an existing value (that's what makes
    // reloads honest).
    try {
      if (!localStorage.getItem(STORAGE_KEY)) {
        writeLastActivity(Date.now())
      }
    } catch {
      // ignore
    }

    schedule()

    for (const ev of ACTIVITY_EVENTS) {
      window.addEventListener(ev, onActivity, { passive: true })
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('storage', onStorage)

    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current)
      for (const ev of ACTIVITY_EVENTS) {
        window.removeEventListener(ev, onActivity)
      }
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('storage', onStorage)
    }
  }, [router])

  return null
}
