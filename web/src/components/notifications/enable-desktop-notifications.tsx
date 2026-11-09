'use client'

import { useEffect, useState } from 'react'
import { Bell, BellOff, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'

type State =
  | 'loading'
  | 'unsupported'
  | 'unconfigured'
  | 'blocked'
  | 'off'
  | 'on'

/**
 * Desktop/web push opt-in. Registers the service worker, requests Notification
 * permission, subscribes via the Push API with our VAPID public key, and POSTs
 * the subscription to /api/push/subscribe. Toggling off unsubscribes + deletes
 * the row. Degrades gracefully when the browser can't do push or VAPID isn't
 * configured on the server.
 */
export function EnableDesktopNotifications() {
  const [state, setState] = useState<State>('loading')
  const [busy, setBusy] = useState(false)
  const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY

  useEffect(() => {
    let cancelled = false
    async function init() {
      if (
        typeof window === 'undefined' ||
        !('serviceWorker' in navigator) ||
        !('PushManager' in window) ||
        !('Notification' in window)
      ) {
        if (!cancelled) setState('unsupported')
        return
      }
      if (!vapidKey) {
        if (!cancelled) setState('unconfigured')
        return
      }
      if (Notification.permission === 'denied') {
        if (!cancelled) setState('blocked')
        return
      }
      try {
        const reg = await navigator.serviceWorker.register('/sw.js')
        const sub = await reg.pushManager.getSubscription()
        if (!cancelled) setState(sub ? 'on' : 'off')
      } catch {
        if (!cancelled) setState('off')
      }
    }
    init()
    return () => {
      cancelled = true
    }
  }, [vapidKey])

  async function enable() {
    if (busy || !vapidKey) return
    setBusy(true)
    try {
      const perm = await Notification.requestPermission()
      if (perm !== 'granted') {
        setState(perm === 'denied' ? 'blocked' : 'off')
        return
      }
      const reg = await navigator.serviceWorker.register('/sw.js')
      await navigator.serviceWorker.ready
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey) as BufferSource,
      })
      const json = sub.toJSON() as {
        endpoint?: string
        keys?: { p256dh?: string; auth?: string }
      }
      const res = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setState('on')
      toast.success('Desktop notifications enabled')
    } catch (err) {
      toast.error('Could not enable notifications', {
        description: err instanceof Error ? err.message : 'Please try again.',
      })
    } finally {
      setBusy(false)
    }
  }

  async function disable() {
    if (busy) return
    setBusy(true)
    try {
      const reg = await navigator.serviceWorker.getRegistration('/sw.js')
      const sub = await reg?.pushManager.getSubscription()
      if (sub) {
        await fetch('/api/push/subscribe', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        }).catch(() => {})
        await sub.unsubscribe().catch(() => {})
      }
      setState('off')
      toast.message('Desktop notifications turned off')
    } finally {
      setBusy(false)
    }
  }

  const COPY: Record<State, string> = {
    loading: 'Checking your browser…',
    unsupported: 'This browser doesn’t support desktop notifications.',
    unconfigured: 'Desktop notifications aren’t configured on this server yet.',
    blocked:
      'Notifications are blocked for this site. Enable them in your browser’s site settings, then reload.',
    off: 'Get a desktop alert the moment something needs your attention — even when LISTD isn’t the active tab.',
    on: 'You’ll get desktop alerts on this device. Turn off any time.',
  }

  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border border-border bg-card p-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          {state === 'on' ? (
            <Bell className="h-4 w-4 text-primary" />
          ) : (
            <BellOff className="h-4 w-4 text-muted-foreground" />
          )}
        </span>
        <div>
          <p className="text-sm font-medium text-foreground">
            Desktop notifications
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">{COPY[state]}</p>
        </div>
      </div>
      {state === 'on' ? (
        <Button variant="outline" size="sm" onClick={disable} disabled={busy}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Turn off'}
        </Button>
      ) : (state === 'off' || state === 'loading') ? (
        <Button
          size="sm"
          onClick={enable}
          disabled={busy || state === 'loading'}
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Enable'}
        </Button>
      ) : null}
    </div>
  )
}

/** VAPID public key (base64url) → Uint8Array for applicationServerKey. */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}
