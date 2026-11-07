/* =============================================================================
   MacroSèche — sw.js (service worker)
   Met l'application en cache pour qu'elle fonctionne hors ligne.

   ⚠️ À CHAQUE MISE À JOUR d'un fichier de l'app, incrémente CACHE_VERSION
   (v1 → v2 → v3…). C'est ce qui déclenche la bannière « Nouvelle version
   disponible – Recharger » sur ton iPhone.
   ============================================================================= */
const CACHE_VERSION = 'v2';

const CACHE_PREFIX = 'macroseche-';
const APP_CACHE = `${CACHE_PREFIX}app-${CACHE_VERSION}`;
const CDN_CACHE = `${CACHE_PREFIX}cdn`;   // lecteur de codes-barres (version figée, gardé entre les mises à jour)

// Tous les fichiers de l'app (chemins RELATIFS : le site est servi dans /<depot>/)
const APP_FILES = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './foods.js',
  './manifest.json',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

const CDN_HOSTS = ['cdn.jsdelivr.net', 'fastly.jsdelivr.net'];

// Installation : on télécharge tous les fichiers (sans passer par le cache HTTP).
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_CACHE).then((cache) => cache.addAll(APP_FILES.map((url) => new Request(url, { cache: 'reload' })))),
  );
  // Pas de skipWaiting() ici : la nouvelle version attend que tu touches « Recharger ».
});

// Activation : suppression des anciens caches de l'app.
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((k) => k.startsWith(CACHE_PREFIX) && k !== APP_CACHE && k !== CDN_CACHE)
      .map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

// Messages envoyés par la page.
self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'SKIP_WAITING') self.skipWaiting();
  if (data.type === 'GET_VERSION' && event.ports && event.ports[0]) {
    event.ports[0].postMessage({ version: CACHE_VERSION });
  }
});

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response && response.ok) cache.put(request, response.clone()).catch(() => {});
  return response;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Fichiers de l'app : depuis le cache (instantané et hors ligne), sinon le réseau.
  if (url.origin === self.location.origin) {
    if (req.mode === 'navigate') {
      event.respondWith((async () => {
        const cached = await caches.match('./index.html', { cacheName: APP_CACHE });
        if (cached) return cached;
        try {
          return await fetch(req);
        } catch (err) {
          return new Response('<!doctype html><meta charset="utf-8"><title>Hors ligne</title><p style="font-family:-apple-system,sans-serif;padding:24px">MacroSèche n’est pas encore disponible hors ligne. Ouvre-la une première fois avec une connexion.</p>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
        }
      })());
      return;
    }
    event.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req)));
    return;
  }

  // Lecteur de codes-barres chargé depuis jsDelivr : gardé en cache après la première utilisation.
  if (CDN_HOSTS.includes(url.hostname)) {
    event.respondWith(cacheFirst(req, CDN_CACHE));
  }
  // Tout le reste (API Open Food Facts…) passe directement par le réseau.
});
