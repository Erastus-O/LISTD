'use client'

import { useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'

/**
 * Client-side session hook. Subscribes to Supabase auth state changes so the
 * UI re-renders on sign-in / sign-out without a full reload.
 *
 * Use sparingly — for sensitive checks, prefer server-side `getSession()` /
 * `requireSession()` from `@/lib/dal`. This hook is for cosmetic UI
 * (header CTAs, conditional nav) only.
 */
export function useSession() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const supabase = createClient()
    let active = true

    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!active) return
      setUser(user)
      setLoading(false)
    })

    const { data: subscription } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setUser(session?.user ?? null)
      }
    )

    return () => {
      active = false
      subscription.subscription.unsubscribe()
    }
  }, [])

  return { user, loading }
}
