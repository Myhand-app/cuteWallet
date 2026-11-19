/* myWallet service worker
 * - App shell (index.html, icons, manifest) is cached so the app opens offline.
 * - Page navigations are network-first, so a new index.html is picked up on the next launch when online.
 * - Google Fonts and the Supabase JS library are cached at runtime so the app also starts offline.
 * - Supabase API / auth and Google sign-in requests are NEVER touched (always go to the network).
 * Bump VERSION whenever you change icons, manifest.json or offline.html.
 */
const VERSION = 'v1.5';
const STATIC = 'mywallet-static-' + VERSION;
const RUNTIME = 'mywallet-runtime-' + VERSION;
const abs = (p) => new URL(p, self.location.href).href;
const SHELL = ['./', './index.html', './offline.html', './manifest.json',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png',
  './icons/icon-maskable-192.png', './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png', './icons/favicon-32.png'];
const NETWORK_ONLY = (h) => h.endsWith('.supabase.co') || h === 'accounts.google.com' ||
  h === 'www.googleapis.com' || h === 'oauth2.googleapis.com';
const RUNTIME_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com', 'cdn.jsdelivr.net', 'cdnjs.cloudflare.com'];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(STATIC);
    await Promise.allSettled(SHELL.map((u) => cache.add(new Request(abs(u), { cache: 'reload' }))));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keep = [STATIC, RUNTIME];
    await Promise.all((await caches.keys()).filter((k) => !keep.includes(k)).map((k) => caches.delete(k)));
    if (self.registration && self.registration.navigationPreload) {
      try { await self.registration.navigationPreload.enable(); } catch (_) {}
    }
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

async function navigate(event) {
  const cache = await caches.open(STATIC);
  try {
    const res = (await event.preloadResponse) || (await fetch(event.request));
    if (res && res.ok && res.type !== 'opaqueredirect') cache.put(abs('./index.html'), res.clone());
    return res;
  } catch (_) {
    return (await cache.match(abs('./index.html'))) || (await cache.match(abs('./offline.html'))) ||
      new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const net = fetch(request).then((res) => { if (res && (res.ok || res.type === 'opaque')) cache.put(request, res.clone()); return res; })
    .catch(() => cached);
  return cached || net;
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const res = await fetch(request);
  if (res && (res.ok || res.type === 'opaque')) cache.put(request, res.clone());
  return res;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (!/^https?:$/.test(url.protocol) || NETWORK_ONLY(url.hostname)) return;

  if (req.mode === 'navigate') { event.respondWith(navigate(event)); return; }

  if (url.origin === self.location.origin) { event.respondWith(staleWhileRevalidate(req, STATIC)); return; }

  if (RUNTIME_HOSTS.includes(url.hostname)) {
    // pinned library versions and font files never change; the fonts CSS is refreshed in the background
    event.respondWith(url.hostname === 'fonts.googleapis.com' ? staleWhileRevalidate(req, RUNTIME) : cacheFirst(req, RUNTIME));
  }
});
