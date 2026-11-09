'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * Client-side UK postcode lookup against the free postcodes.io API.
 * Debounced (350 ms) so typing doesn't fire one request per keystroke.
 *
 * No API key, no signup, no rate-limit headers — postcodes.io is funded
 * by the Ministry of Housing & ONS. Fair-use only; if this surface ever
 * needs to scale past hobby volume we'd swap in GetAddress.io or proxy
 * through a server route to add caching.
 */

export type PostcodeLookup =
  | { state: 'idle' }
  | { state: 'loading' }
  | {
      state: 'valid'
      postcode: string
      city: string
      region: string
    }
  | { state: 'invalid' }
  | { state: 'error' }

const DEBOUNCE_MS = 350
const ENDPOINT = 'https://api.postcodes.io/postcodes/'

export function usePostcodeLookup(rawPostcode: string): PostcodeLookup {
  const [state, setState] = useState<PostcodeLookup>({ state: 'idle' })
  const lastQueryRef = useRef<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const trimmed = rawPostcode.trim()
    if (trimmed.length < 5) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reactive reset when the input shrinks below the lookup threshold; the setState IS the desired side-effect of the input change
      setState({ state: 'idle' })
      lastQueryRef.current = null
      abortRef.current?.abort()
      return
    }

    const normalised = trimmed.toUpperCase()
    if (normalised === lastQueryRef.current) return

    const handle = setTimeout(async () => {
      lastQueryRef.current = normalised
      abortRef.current?.abort()
      const ctl = new AbortController()
      abortRef.current = ctl
      setState({ state: 'loading' })
      try {
        const res = await fetch(
          ENDPOINT + encodeURIComponent(normalised),
          { signal: ctl.signal }
        )
        if (res.status === 404) {
          if (!ctl.signal.aborted) setState({ state: 'invalid' })
          return
        }
        if (!res.ok) {
          if (!ctl.signal.aborted) setState({ state: 'error' })
          return
        }
        const body = (await res.json()) as {
          result: {
            postcode: string
            // postcodes.io returns several fields; we use admin_district
            // (e.g. "Bristol, City of") as the city/town, and region
            // ("South West") as the broader hint.
            admin_district: string | null
            region: string | null
            parish: string | null
          } | null
        }
        if (ctl.signal.aborted) return
        if (!body.result) {
          setState({ state: 'invalid' })
          return
        }
        setState({
          state: 'valid',
          postcode: body.result.postcode,
          city:
            body.result.admin_district ??
            body.result.parish ??
            body.result.region ??
            '',
          region: body.result.region ?? '',
        })
      } catch (err) {
        if ((err as Error).name === 'AbortError') return
        setState({ state: 'error' })
      }
    }, DEBOUNCE_MS)

    return () => clearTimeout(handle)
  }, [rawPostcode])

  return state
}
