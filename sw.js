const CACHE_VERSION = 'v15';
const SHELL_CACHE = 'hazzard-shell-' + CACHE_VERSION;
const RUNTIME_CACHE = 'hazzard-runtime-' + CACHE_VERSION;
const SHELL_URL = './index.html';
const SHELL_FILES = ['./', SHELL_URL, './js/marked.min.js', './manifest.json'];

// Every chapter's content lives inside index.html (baked <template> blocks) or,
// for chapters without one yet, is fetched from manifest.json + chapters/*.md.
// Precache both so a chapter works offline even if it was never opened.
async function collectManifestAssets() {
  const urls = new Set();
  try {
    const manifestRes = await fetch('./manifest.json', { cache: 'no-store' });
    if (!manifestRes.ok) return urls;
    const manifest = await manifestRes.json();
    for (const entry of manifest.chapters || []) {
      if (!entry.file) continue;
      const mdUrl = './chapters/' + entry.file;
      urls.add(mdUrl);
      try {
        const mdRes = await fetch(mdUrl);
        if (!mdRes.ok) continue;
        const mdText = await mdRes.text();
        const imgRe = /!\[[^\]]*\]\(([^)\s]+\.(?:png|jpe?g|gif|svg))\)/gi;
        let match;
        while ((match = imgRe.exec(mdText))) {
          const file = match[1].split('/').pop();
          urls.add('./chapters/' + file);
        }
      } catch {}
    }
  } catch {}
  return urls;
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    await cache.addAll(SHELL_FILES);
    const manifestUrls = await collectManifestAssets();
    await Promise.all([...manifestUrls].map(async url => {
      try {
        const res = await fetch(url);
        if (res && res.ok) await cache.put(url, res);
      } catch {}
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== SHELL_CACHE && k !== RUNTIME_CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;

  // Every navigation (any ?chapter=NN, any query string) renders the same
  // app shell — chapter content lives inside it. Never key the shell lookup
  // on the query string, and never let respondWith reject.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const network = await fetch(req);
        if (network && network.ok) {
          const cache = await caches.open(SHELL_CACHE);
          cache.put(SHELL_URL, network.clone());
          return network;
        }
      } catch {}
      const cache = await caches.open(SHELL_CACHE);
      const cached = await cache.match(req, { ignoreSearch: true }) || await cache.match(SHELL_URL);
      return cached || Response.error();
    })());
    return;
  }

  // manifest.json specifically: always try the network with the browser's
  // own HTTP cache bypassed (GitHub Pages serves it with max-age=600, which
  // a plain fetch() can satisfy from disk cache without ever reaching the
  // network, even inside this "network-first" handler). A stale manifest
  // is exactly how a brand-new chapter can go missing right after a
  // deploy. Offline fallback is unaffected -- still the runtime cache.
  const isManifest = new URL(req.url).pathname.endsWith('/manifest.json');
  if (isManifest) {
    event.respondWith((async () => {
      try {
        const network = await fetch(req, { cache: 'no-store' });
        if (network && network.ok) {
          const cache = await caches.open(RUNTIME_CACHE);
          cache.put(req, network.clone());
        }
        return network;
      } catch {
        const cached = await caches.match(req, { ignoreSearch: true });
        return cached || Response.error();
      }
    })());
    return;
  }

  // Everything else (images, .md, vendored js): network-first,
  // refresh the cache when online, fall back to cache when offline.
  event.respondWith((async () => {
    try {
      const network = await fetch(req);
      if (network && network.ok) {
        const cache = await caches.open(RUNTIME_CACHE);
        cache.put(req, network.clone());
      }
      return network;
    } catch {
      const cached = await caches.match(req, { ignoreSearch: true });
      return cached || Response.error();
    }
  })());
});
