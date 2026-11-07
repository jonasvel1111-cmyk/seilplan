/* Seilplan service worker: the app works without internet, and map tiles you have viewed stay available at sea. */
const APP = 'seilplan-app-v2', TILES = 'seilplan-tiles', MAX_TILES = 6000;
const SHELL = ['./', 'index.html', 'css/style.css', 'js/geo.js', 'js/map.js', 'js/wx.js', 'js/nearby.js', 'js/app.js', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', (e) => { e.waitUntil(caches.open(APP).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith('seilplan-app-') && k !== APP).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });

let trimming = false;
async function trim() { if (trimming) return; trimming = true; try { const c = await caches.open(TILES), ks = await c.keys(); for (let i = 0; i < ks.length - MAX_TILES; i++) await c.delete(ks[i]); } finally { trimming = false; } }

self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // map tiles: cache first, fetch and store when missing
  if (/tile\.openstreetmap\.org$|tiles\.openseamap\.org$/.test(u.hostname)) {
    e.respondWith(caches.open(TILES).then(async (c) => {
      const hit = await c.match(e.request); if (hit) return hit;
      try { const r = await fetch(e.request); if (r.ok || r.type === 'opaque') { c.put(e.request, r.clone()); if (Math.random() < 0.02) trim(); } return r; }
      catch { return new Response('', { status: 504 }); }
    }));
    return;
  }
  // fonts: cache first
  if (/fonts\.(googleapis|gstatic)\.com$/.test(u.hostname)) {
    e.respondWith(caches.open(APP).then(async (c) => { const hit = await c.match(e.request); if (hit) return hit;
      try { const r = await fetch(e.request); c.put(e.request, r.clone()); return r; } catch { return new Response('', { status: 504 }); } }));
    return;
  }
  // the app itself: network first so updates arrive, cache when offline
  if (u.origin === self.location.origin) {
    e.respondWith(fetch(e.request).then((r) => { if (r.ok) caches.open(APP).then((c) => c.put(e.request, r.clone())); return r; })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('index.html'))));
  }
  // weather and place APIs are handled by the app, which stores its own copies
});
