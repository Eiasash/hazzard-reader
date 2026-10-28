const CACHE_VERSION = 'v298'; // On-demand reading and question data.
// Release caches activate only after the reader's update tap.
const SHELL_CACHE = 'hazzard-shell-' + CACHE_VERSION + '-sources';
const SHELL_URL = './index.html';
const LIST_URL = './asset-list.json';
const READY_URL = './.offline-ready';

async function verifyCachedAssets(cache, urls) {
  for (let start = 0; start < urls.length; start += 64) {
    const batch = urls.slice(start, start + 64);
    const matches = await Promise.all(batch.map(url => cache.match(url)));
    for (let i = 0; i < batch.length; i++) {
      if (!matches[i]?.ok) throw new Error('Missing offline file: ' + batch[i]);
    }
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
const FIRST_URL = './.first-install';
let backgroundFill;
async function fillCache(cache, list, previous, files = list.files) {
  const queue = [...files];
  let completed = 0, lastNotice = 0;
  const progress = async () => {
    if (Date.now() - lastNotice < 500 && completed !== files.length) return;
    lastNotice = Date.now();
    const clients = await self.clients.matchAll({ includeUncontrolled: true });
    for (const client of clients) if (client.url.startsWith(self.registration.scope)) client.postMessage({
      type: 'HAZZARD_OFFLINE_STATUS', version: CACHE_VERSION, complete: false,
      progress: Math.floor(completed / list.files.length * 100)
    });
  };
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
      completed++;
      await progress();
    }
  });
  const results = await Promise.allSettled(workers);
  const failed = results.find(r => r.status === 'rejected');
  if (failed) throw failed.reason;
}
async function markComplete(cache, list) {
  const assets = [LIST_URL, ...list.files.map(f => f.url)];
  await verifyCachedAssets(cache, assets);
  await cache.put(READY_URL, new Response(JSON.stringify({ version: CACHE_VERSION, complete: true, assets }), {
    headers: { 'Content-Type': 'application/json' }
  }));
}
async function finishFirstInstall() {
  if (backgroundFill) return backgroundFill;
  backgroundFill = (async () => {
    const cache = await caches.open(SHELL_CACHE);
    if (!await cache.match(FIRST_URL) || await cache.match(READY_URL)) return;
    const response = await cache.match(LIST_URL);
    if (!response) return;
    const list = await response.json();
    await fillCache(cache, list, [cache]);
    await markComplete(cache, list);
    const clients = await self.clients.matchAll();
    for (const client of clients) client.postMessage({ type:'HAZZARD_OFFLINE_STATUS', version:CACHE_VERSION, complete:true });
  })().catch(() => {
    // A first-install interruption leaves the verified shell usable; retry on
    // the next page request or status request when the connection returns.
  }).finally(() => { backgroundFill = null; });
  return backgroundFill;
}
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    // Check before opening our own cache: any existing app cache means update.
    const names = (await caches.keys()).filter(n => n.startsWith('hazzard-'));
    const firstInstall = names.length === 0;
    const previous = await Promise.all(names.map(n => caches.open(n)));
    const cache = await caches.open(SHELL_CACHE);
    await cache.delete(READY_URL);
    const listResponse = await download(LIST_URL);
    const list = await listResponse.clone().json();
    if (list.version !== CACHE_VERSION || !list.files?.length) throw new Error('Wrong offline file list');
    if (firstInstall) {
      const clients = await self.clients.matchAll({ includeUncontrolled:true });
      const manifestFile = list.files.find(f => f.url === './manifest.json');
      const manifestResponse = await download(manifestFile.url, manifestFile.sha256);
      const manifest = await manifestResponse.clone().json();
      await cache.put(manifestFile.url, manifestResponse);
      const needed = new Set(['46', '46s']);
      for (const client of clients) needed.add(new URL(client.url).searchParams.get('chapter'));
      const chapters = new Set(manifest.chapters.filter(c => needed.has(String(c.number))).map(c => './chapters/' + c.file));
      const core = list.files.filter(f => /^(?:\.\/index\.html|\.\/app\.webmanifest|\.\/manifest\.json)$/.test(f.url)
        || /^\.\/(?:js|css)\//.test(f.url)
        || /^\.\/data\/mcq\/(?!images\/)/.test(f.url)
        || ['./data/highlight-aliases.json','./data/mark-unit-registry.json','./data/verification-registry.json','./data/changelog.json','./data/redo-history.json'].includes(f.url)
        || chapters.has(f.url));
      await fillCache(cache, list, [cache], core);
      await cache.put(LIST_URL, listResponse);
      await verifyCachedAssets(cache, [LIST_URL, ...core.map(f => f.url)]);
      await cache.put(FIRST_URL, new Response('verified shell'));
      return;
    }
    // Existing installs keep the all-files, verified, Update-tap workflow.
    await fillCache(cache, list, previous);
    await cache.put(LIST_URL, listResponse);
    await markComplete(cache, list);
    if (names.includes('hazzard-shell-v49-r1')) await self.skipWaiting();
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
  if(event.data?.type==='HAZZARD_VERSION'){event.ports[0]?.postMessage({version:CACHE_VERSION});return;}
  if (event.data?.type === 'HAZZARD_APPLY_UPDATE') {
    event.waitUntil(offlineStatus().then(() => self.skipWaiting()));
    return;
  }
  if (event.data?.type !== 'HAZZARD_OFFLINE_STATUS') return;
  event.waitUntil(finishFirstInstall());
  event.waitUntil((async () => {
    let complete = false;
    try { await offlineStatus(); complete = true; } catch {}
    event.source?.postMessage({ type: 'HAZZARD_OFFLINE_STATUS', version: CACHE_VERSION, complete });
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    if (await cache.match(FIRST_URL)) {
      // Finish activation immediately; controllerchange/status and fetch events
      // keep background completion alive without delaying offline fetches.
      await self.clients.claim();
      return;
    }
    await offlineStatus();
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('hazzard-') && k !== SHELL_CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || !req.url.startsWith(self.registration.scope)) return;
  event.waitUntil(finishFirstInstall());
  event.respondWith((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // Serve one complete release, online as well as offline. Network-first
    // navigation could otherwise mix a new shell with an interrupted update.
    const cached = await cache.match(req.mode === 'navigate' ? SHELL_URL : req, { ignoreSearch: true });
    if (cached) return cached;
    const response = await fetch(req);
    if (response.ok && await cache.match(FIRST_URL)) {
      const listResponse = await cache.match(LIST_URL);
      const list = listResponse && await listResponse.json();
      const asset = list?.files.find(f => new URL(f.url, self.registration.scope).href === req.url.split('?')[0]);
      if (asset && await fingerprint(response.clone()) === asset.sha256) await cache.put(req, response.clone());
    }
    return response;
  })());
});
