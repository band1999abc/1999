/**
 * sw.js — Service Worker for 1999
 * HTML: ネットワーク優先（常に最新を取得）
 * 静的アセット: キャッシュ優先（高速化）
 */

const CACHE = '1999-v4';
const STATIC_SHELL = [
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
      return cache.addAll(STATIC_SHELL);
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
  const url = e.request.url;

  // API — 常にネットワーク
  if (url.includes('/api/')) return;

  // HTML — ネットワーク優先、失敗時のみキャッシュ
  const isHTML = e.request.headers.get('Accept')?.includes('text/html')
    || url.endsWith('.html')
    || url.endsWith('/');
  if (isHTML) {
    e.respondWith(
      fetch(e.request).then(function (res) {
        // 取得できたらキャッシュも更新
        if (res.ok && res.type === 'basic') {
          const clone = res.clone();
          caches.open(CACHE).then(function (cache) { cache.put(e.request, clone); });
        }
        return res;
      }).catch(function () {
        // オフライン時のみキャッシュを返す
        return caches.match(e.request);
      })
    );
    return;
  }

  // 静的アセット — キャッシュ優先
  e.respondWith(
    caches.match(e.request).then(function (cached) {
      return cached || fetch(e.request).then(function (res) {
        if (res.ok && res.type === 'basic') {
          const clone = res.clone();
          caches.open(CACHE).then(function (cache) { cache.put(e.request, clone); });
        }
        return res;
      });
    })
  );
});
