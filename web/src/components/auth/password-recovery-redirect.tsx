'use client'

import { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

/**
 * Supabase password-recovery links redirect to the project's "Site URL" (often
 * the homepage) when the intended `/reset-password` path isn't in the allowed
 * Redirect URLs. The recovery session still arrives — it just lands on the
 * wrong page, leaving the user staring at the homepage.
 *
 * This mounts app-wide and forwards the recovery session to `/reset-password`
 * wherever it shows up, so a misconfigured (or not-yet-fixed) redirect allow
 * list can't strand the user. Harmless everywhere else — it only acts on a
 * recovery hash or the `PASSWORD_RECOVERY` auth event.
 */
export function PasswordRecoveryRedirect() {
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    // Already where we want to be — let the reset form take over.
    if (pathname?.startsWith('/reset-password')) return

    // If the recovery tokens are still on the URL, forward them (hash and all)
    // straight to the reset page before any other client consumes them.
    if (
      typeof window !== 'undefined' &&
      window.location.hash.includes('type=recovery')
    ) {
      router.replace(`/reset-password${window.location.hash}`)
      return
    }

    // Otherwise wait for Supabase to process the link and emit the event
    // (covers both the hash and PKCE `?code=` flows). The session is set on
    // the shared cookie storage, so the reset page picks it up after we route.
    const supabase = createClient()
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        router.replace('/reset-password')
      }
    })
    return () => sub.subscription.unsubscribe()
  }, [pathname, router])

  return null
}
