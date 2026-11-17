/* FACTOR PRO service worker
 * Caches only the static application shell. Financial data (/api/*), the
 * dynamic brand manifest and the uploaded logo are ALWAYS network-only.
 * The offline page intentionally uses generic wording: the service worker has
 * no access to BrandContext, so no brand name is embedded here.
 */
const VERSION = 'factorpro-v1.3.0'
const SHELL_CACHE = `${VERSION}-shell`
const ASSET_CACHE = `${VERSION}-assets`
const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/favicon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
  '/icons/apple-touch-icon.png',
]

/* Never cached: API/dados, manifesto e logo dinâmicos (servidos pelo Flask). */
function isNetworkOnly(url) {
  const path = url.pathname
  return (
    path === '/api' ||
    path.startsWith('/api/') ||
    path === '/manifest.webmanifest' ||
    path === '/brand' ||
    path.startsWith('/brand/')
  )
}

function isCacheableAsset(url) {
  return /\.(js|css|png|svg|webp|woff2?|ttf|ico)$/i.test(url.pathname)
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith('factorpro-') && !key.startsWith(VERSION))
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (isNetworkOnly(url)) return // network-only: dados, manifesto e logo

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok && response.headers.get('content-type')?.includes('text/html')) {
            const copy = response.clone()
            caches.open(SHELL_CACHE).then((cache) => cache.put('/index.html', copy))
          }
          return response
        })
        .catch(async () => {
          const cached = await caches.match('/index.html')
          if (cached) return cached
          return new Response(
            '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">' +
              '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">' +
              '<title>Aplicativo indisponível</title></head>' +
              '<body style="font-family:system-ui,sans-serif;padding:2rem;background:#F5F1E8;color:#1F2A25">' +
              '<h1>Aplicativo indisponível</h1>' +
              '<p>Sem conexão e sem uma versão salva neste dispositivo. ' +
              'Conecte-se à internet e tente novamente.</p></body></html>',
            { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
          )
        }),
    )
    return
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response.ok && isCacheableAsset(new URL(request.url))) {
            const copy = response.clone()
            caches.open(ASSET_CACHE).then((cache) => cache.put(request, copy))
          }
          return response
        })
        .catch(() => cached)
      return cached || network
    }),
  )
})
