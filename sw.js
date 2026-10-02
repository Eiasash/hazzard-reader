const CACHE_VERSION = 'v37';
const SHELL_CACHE = 'hazzard-shell-' + CACHE_VERSION;
const SHELL_URL = './index.html';
const LIST_URL = './asset-list.json';
const READY_URL = './.offline-ready';

async function verifyCachedAssets(cache, urls) {
  for (const url of urls) {
    if (!(await cache.match(url))?.ok) throw new Error('Missing offline file: ' + url);
  }
}
async function fingerprint(response) {
  const digest = await crypto.subtle.digest('SHA-256', await response.arrayBuffer());
  return [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, '0')).join('');
}
async function download(url, hash) {
  let failure;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) throw new Error('Download failed: ' + url);
      if (hash && await fingerprint(response.clone()) !== hash) throw new Error('File changed during update: ' + url);
      return response;
    } catch (error) { failure = error; }
  }
  throw failure;
}
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    await cache.delete(READY_URL);
    const listResponse = await download(LIST_URL);
    const list = await listResponse.clone().json();
    if (list.version !== CACHE_VERSION || !list.files?.length) throw new Error('Wrong offline file list');
    // v35 has no fingerprints. Hash its cached bytes locally, too: no one-time
    // book download is needed. Never inspect another application's caches.
    const names = (await caches.keys()).filter(n => n.startsWith('hazzard-'));
    const previous = await Promise.all(names.map(n => caches.open(n)));
    const queue = [...list.files];
    const workers = Array.from({ length: 6 }, async () => {
      while (queue.length) {
        const { url, sha256 } = queue.shift();
        const absolute = new URL(url, self.registration.scope);
        if (!absolute.href.startsWith(self.registration.scope) || !/^[a-f0-9]{64}$/.test(sha256)) throw new Error('Invalid offline file');
        let response;
        for (const old of previous) {
          const candidate = await old.match(url);
          if (candidate?.ok && await fingerprint(candidate.clone()) === sha256) { response = candidate; break; }
        }
        response ||= await download(url, sha256);
        await cache.put(url, response);
      }
    });
    const results = await Promise.allSettled(workers);
    const failed = results.find(r => r.status === 'rejected');
    if (failed) throw failed.reason; // Old worker and old caches remain intact.
    await cache.put(LIST_URL, listResponse);
    const assets = [LIST_URL, ...list.files.map(f => f.url)];
    await verifyCachedAssets(cache, assets);
    await cache.put(READY_URL, new Response(JSON.stringify({ version: CACHE_VERSION, complete: true, assets }), { headers: { 'Content-Type': 'application/json' } }));
    await self.skipWaiting();
  })());
});
async function offlineStatus() {
  const cache = await caches.open(SHELL_CACHE);
  const ready = await cache.match(READY_URL);
  const status = ready && await ready.json();
  if (status?.version !== CACHE_VERSION || status.complete !== true || !status.assets?.length) throw new Error('Update incomplete');
  await verifyCachedAssets(cache, status.assets);
  return cache;
}
self.addEventListener('message', event => {
  if (event.data?.type !== 'HAZZARD_OFFLINE_STATUS') return;
  event.waitUntil((async () => {
    let complete = false;
    try { await offlineStatus(); complete = true; } catch {}
    event.source?.postMessage({ type: 'HAZZARD_OFFLINE_STATUS', version: CACHE_VERSION, complete });
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    await offlineStatus();
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('hazzard-') && k !== SHELL_CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || !req.url.startsWith(self.registration.scope)) return;
  event.respondWith((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // Serve one complete release, online as well as offline. Network-first
    // navigation could otherwise mix a new shell with an interrupted update.
    const cached = await cache.match(req.mode === 'navigate' ? SHELL_URL : req, { ignoreSearch: true });
    return cached || fetch(req);
  })());
});
