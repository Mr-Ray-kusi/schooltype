const CACHE_NAME = 'schootype-lite-v3';
const APP_SHELL = ['/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

const isDocumentRequest = (request, url) =>
  request.mode === 'navigate' ||
  request.destination === 'document' ||
  url.pathname === '/' ||
  url.pathname.endsWith('.html');

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;
  if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') return;
  if (url.pathname.startsWith('/src/') || url.pathname.startsWith('/@') || url.pathname.includes('node_modules')) {
    return;
  }

  // Always take the latest HTML so Vite chunk hashes stay in sync after deploy.
  if (isDocumentRequest(request, url)) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match('/')))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const networked = fetch(request)
        .then((response) => {
          if (response && response.status === 200 && response.type === 'basic') {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => cached);
      if (url.pathname.startsWith('/assets/') && cached) return cached;
      return networked;
    })
  );
});
