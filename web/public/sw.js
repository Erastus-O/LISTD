/* LISTD Pro service worker — Web Push for the desktop/web app.
 * Shows a notification on `push` and routes to the deep link on click.
 * Payload shape (from lib/push.ts): { title, body, url?, tag?, icon? } */

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch (_e) {
    data = { title: 'LISTD', body: event.data ? event.data.text() : '' }
  }
  const title = data.title || 'LISTD'
  const options = {
    body: data.body || '',
    tag: data.tag || undefined,
    renotify: Boolean(data.tag),
    icon: '/listd-pro-green.png',
    badge: '/listd-pro-green.png',
    data: { url: data.url || '/' },
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = (event.notification.data && event.notification.data.url) || '/'
  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // Focus an existing tab if one is open, navigating it to the target.
        for (const client of clientList) {
          if ('focus' in client) {
            if ('navigate' in client) {
              client.navigate(target).catch(() => {})
            }
            return client.focus()
          }
        }
        return self.clients.openWindow(target)
      })
  )
})

// Activate immediately so a newly-registered SW can receive pushes without a
// reload.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) =>
  event.waitUntil(self.clients.claim())
)
