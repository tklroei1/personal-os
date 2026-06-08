const CACHE = 'personal-os-v15';
const ASSETS = ['/', '/index.html', '/manifest.json', '/icon.svg'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.pathname.startsWith('/api/')) return;

  // Network-first for HTML navigation AND JavaScript — always serve the
  // freshest app shell and code (so jarvis.js / app updates reach the user)
  if (e.request.mode === 'navigate' || url.pathname === '/' ||
      url.pathname.endsWith('.html') || url.pathname.endsWith('.js')) {
    e.respondWith(
      fetch(e.request).then(res => {
        if (res.ok) caches.open(CACHE).then(c => c.put(e.request, res.clone()));
        return res;
      }).catch(() => caches.match(e.request).then(r => r || caches.match('/index.html')))
    );
    return;
  }

  // Cache-first for other static assets (icons, manifest, fonts)
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (!res || res.status !== 200 || res.type !== 'basic') return res;
        caches.open(CACHE).then(c => c.put(e.request, res.clone()));
        return res;
      }).catch(() => caches.match('/index.html'));
    })
  );
});

// ───── NOTIFICATIONS ─────
// Tapping a notification focuses an open tab/PWA window, or opens a new one.
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if ('focus' in c) {
          if ('navigate' in c) { try { c.navigate(target); } catch (err) {} }
          return c.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })
  );
});

// Server-sent Web Push (future use — needs VAPID keys on the backend).
self.addEventListener('push', e => {
  let payload = { title: '⏰ Personal OS', body: 'יש לך תזכורת', url: '/?page=reminders' };
  try { if (e.data) payload = Object.assign(payload, e.data.json()); } catch (err) {}
  e.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body, icon: '/icon.svg', badge: '/icon.svg',
      dir: 'rtl', lang: 'he', vibrate: [130, 70, 130],
      data: { url: payload.url }
    })
  );
});
