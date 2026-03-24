const CACHE_NAME = 'fitness-v12';

const PRECACHE = [
  '/app/index.html',
  '/app/style.css',
  '/app/js/app.js',
  '/app/js/engine.js',
  '/app/js/exercises.js',
  '/app/js/store.js',
  '/app/js/voice.js',
  '/app/js/bgm.js',
  '/app/manifest.json',
  '/app/icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') return;

  // Network-first for API calls
  if (url.pathname.includes('/rest/') || url.hostname.includes('supabase')) {
    e.respondWith(
      fetch(e.request).catch(() => caches.match(e.request))
    );
    return;
  }

  // Cache-first for WAV/MP4 assets (large files)
  if (/\.(wav|mp4)$/.test(url.pathname)) {
    e.respondWith(
      caches.match(e.request).then(cached => {
        if (cached) return cached;
        return fetch(e.request).then(res => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
          }
          return res;
        });
      })
    );
    return;
  }

  // Network-first for app shell (JS/CSS/HTML), fall back to cache when offline
  e.respondWith(
    fetch(e.request).then(res => {
      if (res.ok) {
        const clone = res.clone();
        caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
      }
      return res;
    }).catch(() => caches.match(e.request))
  );
});
