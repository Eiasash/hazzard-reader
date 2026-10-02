const CACHE_VERSION = 'v32';
const SHELL_CACHE = 'hazzard-shell-' + CACHE_VERSION;
const RUNTIME_CACHE = 'hazzard-runtime-' + CACHE_VERSION;
const SHELL_URL = './index.html';
const SHELL_FILES = ['./', SHELL_URL, './js/marked.min.js', './manifest.json'];
const READY_URL = './.offline-ready';

async function matchActiveCache(request) {
  for (const cacheName of [RUNTIME_CACHE, SHELL_CACHE].filter(name => name.startsWith('hazzard-'))) {
    const cached = await caches.match(request, { cacheName, ignoreSearch: true });
    if (cached) return cached;
  }
}

async function verifyCachedAssets(cache, urls) {
  for (const url of urls) {
    const response = await cache.match(url);
    if (!response?.ok) throw new Error('Precache verification failed: ' + url);
  }
}

async function precache(url, cache) {
  let failure;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(url, { cache: url.endsWith('manifest.json') ? 'no-store' : 'default' });
      if (!response.ok) throw new Error('Precache HTTP ' + response.status + ': ' + url);
      await cache.put(url, response.clone());
      return response;
    } catch (error) { failure = error; }
  }
  throw failure || new Error('Precache failed: ' + url);
}

// Every chapter's content lives inside index.html (baked <template> blocks) or,
// for chapters without one yet, is fetched from manifest.json + chapters/*.md.
// Precache both so a chapter works offline even if it was never opened.
async function collectManifestAssets(cache) {
  const urls = new Set();
  const manifestRes = await cache.match('./manifest.json');
  if (!manifestRes) throw new Error('Precache manifest missing');
  const manifest = await manifestRes.json();
  if (!Array.isArray(manifest.chapters) || !manifest.chapters.length) throw new Error('Precache manifest has no chapters');
  for (const entry of manifest.chapters) {
    if (!entry.file) throw new Error('Precache chapter has no file');
    const mdUrl = './chapters/' + entry.file;
    urls.add(mdUrl);
    // Discovery must also succeed: otherwise missing Markdown hides its figures.
    const mdRes = await precache(mdUrl, cache);
    const mdText = await mdRes.text();
    const imgRe = /!\[[^\]]*\]\(([^)\s]+\.(?:png|jpe?g|gif|svg))\)/gi;
    let match;
    while ((match = imgRe.exec(mdText))) {
      const file = match[1].split('/').pop();
      urls.add('./chapters/' + file);
    }
  }
  return urls;
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    await cache.delete(READY_URL);
    await Promise.all(SHELL_FILES.map(url => precache(url, cache)));
    const manifestUrls = await collectManifestAssets(cache);
    // Markdown was cached during discovery. Every remaining asset must succeed.
    await Promise.all([...manifestUrls].filter(url => !url.endsWith('.md')).map(url => precache(url, cache)));
    const assets = [...new Set([...SHELL_FILES, ...manifestUrls])];
    await verifyCachedAssets(cache, assets);
    await cache.put(READY_URL, new Response(JSON.stringify({ version: CACHE_VERSION, complete: true, assets }), { headers: { 'Content-Type': 'application/json' } }));
    if (!(await cache.match(READY_URL))) throw new Error('Precache readiness marker missing');
    await self.skipWaiting();
  })());
});

self.addEventListener('message', event => {
  if (event.data?.type !== 'HAZZARD_OFFLINE_STATUS') return;
  event.waitUntil((async () => {
    let complete = false;
    try {
      const cache = await caches.open(SHELL_CACHE);
      const ready = await cache.match(READY_URL);
      const status = ready && await ready.json();
      if (status?.version === CACHE_VERSION && status.complete === true && Array.isArray(status.assets) && status.assets.length) {
        await verifyCachedAssets(cache, status.assets);
        complete = true;
      }
    } catch {}
    event.source?.postMessage({ type: 'HAZZARD_OFFLINE_STATUS', version: CACHE_VERSION, complete });
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('hazzard-') && k !== SHELL_CACHE && k !== RUNTIME_CACHE).map(k => caches.delete(k)));
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
          cache.put('./', network.clone());
          return network;
        }
      } catch {}
      const cache = await caches.open(SHELL_CACHE);
      const cached = await cache.match(SHELL_URL) || await cache.match(req, { ignoreSearch: true });
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
        const cached = await matchActiveCache(req);
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
      const cached = await matchActiveCache(req);
      return cached || Response.error();
    }
  })());
});
