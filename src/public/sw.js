/**
 * Panelku Service Worker
 * Provides offline asset caching, PWA installation, and WebPush background notifications.
 */
/* global self, caches, clients */

const CACHE_NAME = 'panelku-v2.9.1';
const STATIC_ASSETS = [
  '/css/bootstrap.min.css',
  '/css/bootstrap-icons.css',
  '/css/app.css',
  '/css/fonts.css',
  '/js/bootstrap.bundle.min.js',
  '/js/app.js',
  '/images/logo.png',
  '/favicon.png',
  '/manifest.json',
  '/public/manifest.json',
];

// Install Event
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn('[SW] Cache prefetch error:', err);
      });
    })
  );
  self.skipWaiting();
});

// Activate Event (Cleanup old caches)
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Fetch Event (Network First for navigation/API, Cache First for static styles/scripts)
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip non-GET, API requests, WebSockets, or browser extensions
  if (
    event.request.method !== 'GET' ||
    url.pathname.startsWith('/api') ||
    url.pathname.startsWith('/socket.io') ||
    !url.protocol.startsWith('http')
  ) {
    return;
  }

  // Static Assets: Cache first with network fallback
  const isStatic =
    url.pathname.startsWith('/public/') ||
    url.pathname.startsWith('/css/') ||
    url.pathname.startsWith('/js/') ||
    url.pathname.startsWith('/images/') ||
    url.pathname.startsWith('/fonts/') ||
    url.pathname === '/favicon.png' ||
    url.pathname === '/manifest.json';

  if (isStatic) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((res) => {
          if (res.status === 200) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(event.request, clone));
          }
          return res;
        }).catch(() => cached);
      })
    );
    return;
  }

  // HTML Pages: Network first with cache fallback
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});

// WebPush Notification Event
self.addEventListener('push', (event) => {
  let payload = {
    title: 'Panelku Alert',
    body: 'Notification from your server',
    icon: '/public/images/logo.png',
    badge: '/public/images/logo.png',
    url: '/',
  };

  if (event.data) {
    try {
      payload = Object.assign(payload, event.data.json());
    } catch {
      payload.body = event.data.text();
    }
  }

  const options = {
    body: payload.body,
    icon: payload.icon || '/public/images/logo.png',
    badge: payload.badge || '/public/images/logo.png',
    vibrate: [100, 50, 100],
    data: {
      url: payload.url || '/',
    },
    actions: [
      { action: 'open', title: 'Open Panel' },
      { action: 'dismiss', title: 'Dismiss' },
    ],
  };

  event.waitUntil(
    self.registration.showNotification(payload.title, options)
  );
});

// Notification Click Event
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'dismiss') return;

  const targetUrl = event.notification.data?.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(targetUrl) && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});
