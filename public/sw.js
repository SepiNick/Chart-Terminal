// Service worker: Web Push notifications only (no offline caching — the app needs the server anyway).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
// Deliberately empty: older Chrome on Android only offers "Install app" for pages whose worker has a fetch handler. It never calls respondWith, so requests go straight to the network.
self.addEventListener('fetch', () => {});

// Payload from the server (server/notify): { title, body, tag, data: { url, ... } }
self.addEventListener('push', e => {
  let p = {};
  try { p = e.data ? e.data.json() : {} } catch { p = { body: e.data.text() } }
  e.waitUntil(self.registration.showNotification(p.title || 'Chart Terminal', {
    body: p.body || '', tag: p.tag, data: p.data || {}, icon: '/icon-192.png', badge: '/badge-96.png',
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const raw = (e.notification.data && e.notification.data.url) || '/';
  let url = new URL(raw, self.location.origin);
  if (url.origin !== self.location.origin) url = new URL('/', self.location.origin);   // never open foreign sites
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const win = wins.find(w => new URL(w.url).origin === self.location.origin);
    if (!win) return self.clients.openWindow(url.href);
    await win.focus();
    if (raw !== '/' && win.url !== url.href && 'navigate' in win) await win.navigate(url.href).catch(() => {});
  })());
});

// The browser rotated the subscription: register the new one (needs a logged-in session cookie; best effort).
self.addEventListener('pushsubscriptionchange', e => {
  e.waitUntil((async () => {
    const post = (path, body) => fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    let sub = e.newSubscription;
    if (!sub) {
      const { publicKey } = await (await fetch('/api/notify/push/key', { credentials: 'same-origin' })).json();
      sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: publicKey });
    }
    if (e.oldSubscription) await post('/api/notify/push/unsubscribe', { endpoint: e.oldSubscription.endpoint }).catch(() => {});
    await post('/api/notify/push/subscribe', { subscription: sub.toJSON(), agent: self.navigator.userAgent });
  })().catch(() => {}));
});
