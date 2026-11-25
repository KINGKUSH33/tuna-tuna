/* Tuna Tuna v3.1.1 service worker. New cache name drops anything saved by v3.1 and earlier. */
const CACHE = 'tuna-tuna-v3.1.1';
const ASSETS = [
  './',
  'index.html',
  'privacy.html',
  'styles.css',
  'app.js',
  'config.js',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/maskable.svg'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    const old = keys.filter(k => k !== CACHE);
    await Promise.all(old.map(k => caches.delete(k)));
    await self.clients.claim();
    // Older clients are still showing the cached app. Send them to this version on this refresh.
    if (!old.length) return;
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    await Promise.all(clients.map(async client => {
      if (!client.navigate) return;
      try { await client.navigate(client.url); } catch (err) {}
    }));
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(caches.open(CACHE).then(async c => {
    const hit = await c.match(req, { ignoreSearch: true });
    const net = fetch(req).then(r => { if (r && r.ok) c.put(req, r.clone()); return r; }).catch(() => hit || c.match('index.html'));
    return hit || net;
  }));
});
