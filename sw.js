const SHELL_CACHE = 'hazzard-shell-v1';
const RUNTIME_CACHE = 'hazzard-runtime-v1';
const SHELL_FILES = ['./', './index.html', './js/marked.min.js', './manifest.json'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(cache => cache.addAll(SHELL_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== SHELL_CACHE && k !== RUNTIME_CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Cache-first, falling back to network and updating the runtime cache as new
// chapters/images/manifest entries are visited, so any file added later works
// offline the next time without touching this file.
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  event.respondWith(
    caches.match(req).then(cached => {
      const network = fetch(req).then(res => {
        if (res && res.ok) caches.open(RUNTIME_CACHE).then(cache => cache.put(req, res.clone()));
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
