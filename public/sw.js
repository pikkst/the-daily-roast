// ============================================
// The Daily Roast — Service Worker (PWA)
// Cache-first for assets, network-first for API/HTML
// ============================================

const CACHE_NAME = 'daily-roast-v1';
const STATIC_ASSETS = [
  '/',
  '/article',
  '/radio',
  '/quiz',
  '/weekly',
  '/weekly.html',
  '/css/style.css',
  '/js/config.js',
  '/js/app.js',
  '/js/article.js',
  '/js/weekly.js',
  '/js/support.js',
  '/js/comments.js',
  '/manifest.json',
  '/manifest-radio.json'
];

// Install: pre-cache static assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(STATIC_ASSETS).catch(err => {
        console.warn('[SW] Some assets failed to cache:', err);
      });
    })
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch strategy
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Skip non-GET and cross-origin
  if (event.request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;

  // API calls & HTML pages: network-first
  if (url.pathname.startsWith('/rest/') || url.pathname === '/sitemap.xml' ||
      event.request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(event.request)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return res;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Static assets: cache-first
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(res => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        return res;
      });
    })
  );
});
