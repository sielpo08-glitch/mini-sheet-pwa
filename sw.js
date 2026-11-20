/* Service Worker - Mini-Foglio di Calcolo
 * Strategia: "cache first, poi aggiorna in background" (stale-while-revalidate)
 * per le risorse statiche dello stesso dominio. I percorsi sono RELATIVI allo
 * scope del SW, quindi funzionano sia su GitHub Pages (/mini-sheet-pwa/) sia su Vercel (/).
 * Quando modifichi un file, incrementa CACHE_VERSION per forzare l'aggiornamento. */
const CACHE_VERSION = 'v1';
const CACHE = 'mini-sheet-' + CACHE_VERSION;
const ASSETS = [
  './', './index.html', './manifest.json',
  './css/style.css', './vendor/bootstrap.min.css',
  './js/app.js', './js/engine.js', './js/coordinates.js',
  './icons/icon-192.png', './icons/icon-512.png'
];

// INSTALL: precarica tutte le risorse statiche
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

// ACTIVATE: elimina le cache di versioni vecchie e prende il controllo delle pagine
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// FETCH: risponde dalla cache (offline OK) e intanto aggiorna la cache dalla rete
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => null);
      if (cached) { e.waitUntil(network); return cached; }
      return network.then((res) => res || (req.mode === 'navigate' ? caches.match('./index.html') : Response.error()));
    })
  );
});
