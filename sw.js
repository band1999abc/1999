/**
 * sw.js — Service Worker for 1999
 * Caches the app shell for fast load and offline fallback.
 */

const CACHE = '1999-v3';
const SHELL = [
  '/',
  '/index.html',
  '/style.css',
  '/script.js',
  '/weather.js',
  '/whale.js',
  '/whale_transparent.png',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-180.png',
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return cache.addAll(SHELL);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (k) { return k !== CACHE; })
            .map(function (k) { return caches.delete(k); })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function (e) {
  // API calls — always go to network
  if (e.request.url.includes('/api/')) {
    return;
  }
  e.respondWith(
    caches.match(e.request).then(function (cached) {
      return cached || fetch(e.request).then(function (res) {
        // キャッシュ可能なレスポンスはキャッシュに追加
        if (res.ok && res.type === 'basic') {
          const clone = res.clone();
          caches.open(CACHE).then(function (cache) {
            cache.put(e.request, clone);
          });
        }
        return res;
      });
    })
  );
});
