/* sw.js */
const VERSION = 'v3';
const CACHE_PREFIX = 'eatmi';
const CACHE_NAME = `${CACHE_PREFIX}-${VERSION}`;

const APP_SHELL = [
  '/',                // przekieruje do index.html
  '/index.html',      // jeśli serwujesz plikowo
  '/manifest.webmanifest',
  // Własne lokalne zasoby dodaj tutaj (np. /styles.css, /app.js, /icons/*)
  // Nie dodawaj zewnętrznych CDN do precache (często „opaque” i mogą się wysypać przy addAll)
];

// Prosty offline HTML (fallback przy braku sieci)
const OFFLINE_HTML = `
<!doctype html><html lang="pl"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Offline – eatmi</title>
<style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Inter,Arial,sans-serif;padding:2rem;max-width:42rem;margin:auto;color:#0f172a;background:#fff}
.card{border:1px solid #e2e8f0;border-radius:1rem;padding:1.25rem;background:#fff;box-shadow:0 8px 24px rgba(2,6,23,.08)}
h1{font-size:1.4rem;margin:0 0 .5rem} a{color:#0f172a}
.btn{display:inline-block;margin-top:1rem;padding:.6rem 1rem;border-radius:.75rem;background:#facc15;font-weight:700;text-decoration:none;color:#111827}
</style>
<body><div class="card">
<h1>Jesteś offline</h1>
<p>Brak połączenia z internetem. Część zawartości może być dostępna z pamięci podręcznej. Gdy wrócisz online, wszystko zadziała normalnie.</p>
<a class="btn" href="/">Odśwież</a>
</div>
`;

// Instalacja – precache
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      await cache.addAll(APP_SHELL);
    } catch (e) {
      // Nie przerywamy instalacji, gdyby jakiś zasób się nie dodał (np. brak index.html w trybie SPA)
      console.warn('[SW] addAll warning:', e);
    }
    self.skipWaiting();
  })());
});

// Aktywacja – sprzątanie starych cache’y
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter(k => k.startsWith(CACHE_PREFIX) && k !== CACHE_NAME)
        .map(k => caches.delete(k))
    );
    self.clients.claim();
  })());
});

// Pomocnicze „strategie”
async function networkFirst(req) {
  try {
    const fresh = await fetch(req);
    const cache = await caches.open(CACHE_NAME);
    cache.put(req, fresh.clone());
    return fresh;
  } catch (err) {
    const cacheMatch = await caches.match(req);
    return cacheMatch || new Response(OFFLINE_HTML, { headers: { 'Content-Type': 'text/html; charset=UTF-8' } });
  }
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(req);
  const fetchPromise = fetch(req).then(res => {
    // Nie cache’uj odpowiedzi „opaque” z błędnym CORS dla cross-origin? Zwykle można, ale bez kontroli nagłówków.
    try { cache.put(req, res.clone()); } catch {}
    return res;
  }).catch(() => cached);
  return cached || fetchPromise;
}

async function cacheFirst(req) {
  const cached = await caches.match(req);
  if (cached) return cached;
  const res = await fetch(req);
  const cache = await caches.open(CACHE_NAME);
  try { cache.put(req, res.clone()); } catch {}
  return res;
}

// Routing żądań
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // 1) Nawigacje (HTML) – network-first z fallbackiem offline
  if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
    event.respondWith(networkFirst(req));
    return;
  }

  // 2) Fonty – cache-first
  if (url.origin.includes('fonts.gstatic.com')) {
    event.respondWith(cacheFirst(req));
    return;
  }

  // 3) Style/JS/Obrazy – stale-while-revalidate
  if (
    req.destination === 'style' ||
    req.destination === 'script' ||
    req.destination === 'image' ||
    req.destination === 'font'
  ) {
    event.respondWith(staleWhileRevalidate(req));
    return;
  }

  // 4) Domyślne – SWR
  event.respondWith(staleWhileRevalidate(req));
});
