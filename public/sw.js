const OFFLINE_CACHE = 'keeply-offline-v1'
const STATIC_CACHE = 'keeply-static-v1'
const OFFLINE_PAGE = '/offline.html'

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(OFFLINE_CACHE).then((cache) => cache.add(OFFLINE_PAGE)))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  const keep = [OFFLINE_CACHE, STATIC_CACHE]
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !keep.includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)

  // Pages: network first, offline page when there is no connection. Plans are never cached here.
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE_PAGE)))
    return
  }

  // Next's build output is content-hashed and immutable: cache first.
  if (url.origin === self.location.origin && url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        const hit = await cache.match(request)
        if (hit) return hit
        const response = await fetch(request)
        if (response.ok) event.waitUntil(cache.put(request, response.clone()).then(() => trim(cache)))
        return response
      }),
    )
  }
})

// Every deploy adds new hashed files under the same cache name; keep only the newest entries
// so old builds do not pile up on the phone.
const MAX_STATIC_ENTRIES = 150

async function trim(cache) {
  const keys = await cache.keys()
  await Promise.all(keys.slice(0, Math.max(0, keys.length - MAX_STATIC_ENTRIES)).map((k) => cache.delete(k)))
}
